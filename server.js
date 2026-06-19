import http from "node:http";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

loadEnv();

const PORT = Number(process.env.PORT || 5173);
const RIOT_API_KEY = process.env.RIOT_API_KEY || "";
const DEFAULT_ROUTING = process.env.DEFAULT_ROUTING || "americas";
const DEFAULT_LOL_PLATFORM = process.env.DEFAULT_LOL_PLATFORM || "na1";
const RSO_CLIENT_ID = process.env.RSO_CLIENT_ID || "";
const RSO_CLIENT_SECRET = process.env.RSO_CLIENT_SECRET || "";
const RSO_REDIRECT_URI = process.env.RSO_REDIRECT_URI || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sessions = new Map();
const rsoStates = new Map();

const ROUTING_BY_PLATFORM = {
  br1: "americas",
  la1: "americas",
  la2: "americas",
  na1: "americas",
  oc1: "sea",
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  jp1: "asia",
  kr: "asia",
  ph2: "sea",
  sg2: "sea",
  th2: "sea",
  tw2: "sea",
  vn2: "sea"
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

startServer(PORT);

function startServer(port, attempts = 0) {
  const server = createAppServer();
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts < 10) {
      startServer(port + 1, attempts + 1);
      return;
    }
    throw error;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`RGTracker running at http://127.0.0.1:${port}`);
  });
}

function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/auth/")) {
        await handleAuth(req, url, res);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, url, res);
        return;
      }
      await serveStatic(url.pathname, res);
    } catch (error) {
      sendJson(res, error.status || 500, {
        error: error.publicMessage || "Something went wrong while loading this profile.",
        detail: process.env.NODE_ENV === "production" ? undefined : error.message
      });
    }
  });
}

async function handleApi(req, url, res) {
  if (url.pathname === "/api/auth/session") {
    const session = getSession(req);
    sendJson(res, 200, {
      authenticated: Boolean(session),
      rsoConfigured: hasRsoConfig(),
      account: session?.account || null
    });
    return;
  }

  if (!RIOT_API_KEY) {
    throw publicError(500, "Missing RIOT_API_KEY. Add it to .env before searching Riot profiles.");
  }

  if (url.pathname === "/api/profile/league") {
    const riotId = parseRiotId(url.searchParams.get("riotId"));
    const platform = (url.searchParams.get("platform") || DEFAULT_LOL_PLATFORM).toLowerCase();
    const routing = ROUTING_BY_PLATFORM[platform] || DEFAULT_ROUTING;
    const data = await buildLeagueProfile(riotId, platform, routing);
    sendJson(res, 200, data);
    return;
  }

  if (url.pathname === "/api/profile/tft") {
    const riotId = parseRiotId(url.searchParams.get("riotId"));
    const platform = (url.searchParams.get("platform") || DEFAULT_LOL_PLATFORM).toLowerCase();
    const routing = ROUTING_BY_PLATFORM[platform] || DEFAULT_ROUTING;
    const data = await buildTftProfile(riotId, platform, routing);
    sendJson(res, 200, data);
    return;
  }

  if (url.pathname === "/api/profile/valorant") {
    const session = getSession(req);
    if (!session) {
      throw publicError(401, "Connect your Riot account before viewing VALORANT stats.");
    }
    const riotId = parseRiotId(url.searchParams.get("riotId"));
    if (!sameRiotId(riotId, session.account)) {
      throw publicError(403, "VALORANT stats are only available for Riot accounts that have opted in through RGTracker.");
    }
    const routing = url.searchParams.get("routing") || DEFAULT_ROUTING;
    const region = url.searchParams.get("region") || normalizeValorantRegion(routing);
    const data = await buildValorantProfile({ gameName: session.account.gameName, tagLine: session.account.tagLine }, routing, region);
    sendJson(res, 200, data);
    return;
  }

  throw publicError(404, "Unknown API route.");
}

async function handleAuth(req, url, res) {
  if (url.pathname === "/auth/riot/start") {
    const returnTo = safeReturnPath(url.searchParams.get("returnTo")) || "/valorant";
    if (!hasRsoConfig()) {
      redirect(res, appendQuery(returnTo, "rso", "not_configured"));
      return;
    }
    const state = crypto.randomBytes(24).toString("hex");
    rsoStates.set(state, { returnTo, createdAt: Date.now() });
    pruneRsoStates();
    setCookie(res, "rgt_rso_state", state, { maxAge: 600, httpOnly: true, secure: isSecureRequest(req), sameSite: "Lax" });
    const authorizeUrl = new URL("https://auth.riotgames.com/authorize");
    authorizeUrl.searchParams.set("client_id", RSO_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", RSO_REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "openid offline_access");
    authorizeUrl.searchParams.set("state", state);
    redirect(res, authorizeUrl.toString());
    return;
  }

  if (url.pathname === "/auth/riot/callback") {
    const error = url.searchParams.get("error");
    if (error) {
      clearCookie(res, "rgt_rso_state", { secure: isSecureRequest(req) });
      redirect(res, `/valorant?rso=${encodeURIComponent(error)}`);
      return;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = parseCookies(req.headers.cookie || "").rgt_rso_state;
    const storedState = state ? rsoStates.get(state) : null;
    if (!code || !state || !cookieState || cookieState !== state || !storedState) {
      clearCookie(res, "rgt_rso_state", { secure: isSecureRequest(req) });
      redirect(res, "/valorant?rso=invalid_state");
      return;
    }

    rsoStates.delete(state);
    clearCookie(res, "rgt_rso_state", { secure: isSecureRequest(req) });
    try {
      const token = await exchangeRsoCode(code);
      const account = await fetchRsoAccount(token.access_token);
      const sessionId = createSession({ account });
      setCookie(res, "rgt_session", sessionId, { maxAge: 60 * 60 * 24 * 14, httpOnly: true, secure: isSecureRequest(req), sameSite: "Lax" });
      const returnTo = storedState.returnTo.includes("riotId=")
        ? storedState.returnTo
        : `/valorant?riotId=${encodeURIComponent(`${account.gameName}#${account.tagLine}`)}`;
      redirect(res, returnTo);
    } catch {
      redirect(res, "/valorant?rso=token_exchange_failed");
    }
    return;
  }

  if (url.pathname === "/auth/logout") {
    const sessionId = parseCookies(req.headers.cookie || "").rgt_session;
    if (sessionId) sessions.delete(sessionId);
    clearCookie(res, "rgt_session", { secure: isSecureRequest(req) });
    redirect(res, "/");
    return;
  }

  throw publicError(404, "Unknown auth route.");
}

async function buildLeagueProfile(riotId, platform, routing) {
  const account = await getAccountByRiotId(riotId, routing);
  const [summoner, matchIds] = await Promise.all([
    riotFetch(`https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`),
    riotFetch(`https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?start=0&count=12`)
  ]);

  const [rankedEntries, matches] = await Promise.all([
    riotFetch(`https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(account.puuid)}`).catch(() => []),
    Promise.all(matchIds.slice(0, 10).map((id) => riotFetch(`https://${routing}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(id)}`).catch(() => null)))
  ]);

  const analyzedMatches = matches.filter(Boolean).map((match) => summarizeLolMatch(match, account.puuid)).filter(Boolean);

  return {
    game: "league",
    account,
    region: platform.toUpperCase(),
    updatedAt: new Date().toISOString(),
    summoner: {
      name: summoner.name,
      level: summoner.summonerLevel,
      profileIconId: summoner.profileIconId
    },
    ranked: rankedEntries.map(formatLeagueEntry).sort((a, b) => queuePriority(a.queueType) - queuePriority(b.queueType)),
    overview: summarizeLolOverview(analyzedMatches),
    championPool: summarizeChampionPool(analyzedMatches),
    recentMatches: analyzedMatches
  };
}

async function buildTftProfile(riotId, platform, routing) {
  const account = await getAccountByRiotId(riotId, routing);
  const [summoner, matchIds] = await Promise.all([
    riotFetch(`https://${platform}.api.riotgames.com/tft/summoner/v1/summoners/by-puuid/${encodeURIComponent(account.puuid)}`).catch(() => null),
    riotFetch(`https://${routing}.api.riotgames.com/tft/match/v1/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?start=0&count=20`)
  ]);

  const [rankedEntries, matches] = await Promise.all([
    riotFetch(`https://${platform}.api.riotgames.com/tft/league/v1/entries/by-puuid/${encodeURIComponent(account.puuid)}`).catch(() => []),
    Promise.all(matchIds.slice(0, 16).map((id) => riotFetch(`https://${routing}.api.riotgames.com/tft/match/v1/matches/${encodeURIComponent(id)}`).catch(() => null)))
  ]);

  const analyzedMatches = matches.filter(Boolean).map((match) => summarizeTftMatch(match, account.puuid)).filter(Boolean);

  return {
    game: "tft",
    account,
    region: platform.toUpperCase(),
    updatedAt: new Date().toISOString(),
    summoner: summoner ? {
      name: summoner.name,
      level: summoner.summonerLevel,
      profileIconId: summoner.profileIconId
    } : null,
    ranked: rankedEntries.map(formatTftEntry).sort((a, b) => queuePriority(a.queueType) - queuePriority(b.queueType)),
    overview: summarizeTftOverview(analyzedMatches),
    traitPool: summarizeTftTraits(analyzedMatches),
    unitPool: summarizeTftUnits(analyzedMatches),
    recentMatches: analyzedMatches
  };
}

async function buildValorantProfile(riotId, routing, region) {
  const account = await getAccountByRiotId(riotId, routing);
  const content = await riotFetch(`https://${region}.api.riotgames.com/val/content/v1/contents?locale=en-US`).catch(() => null);
  const contentNames = mapValorantContent(content);
  let matchlist;
  try {
    matchlist = await riotFetch(`https://${region}.api.riotgames.com/val/match/v1/matchlists/by-puuid/${encodeURIComponent(account.puuid)}`);
  } catch (error) {
    if ([401, 403, 404].includes(error.status)) {
      return {
        game: "valorant",
        account,
        region: region.toUpperCase(),
        updatedAt: new Date().toISOString(),
        apiLimited: true,
        message: "This Riot API key cannot access Valorant match history for that account. Riot limits VAL-MATCH-V1 access by product approval.",
        overview: emptyValorantOverview(),
        agentPool: [],
        recentMatches: []
      };
    }
    throw error;
  }

  const ids = (matchlist.history || []).slice(0, 10).map((match) => match.matchId);
  const matches = await Promise.all(ids.map((id) => riotFetch(`https://${region}.api.riotgames.com/val/match/v1/matches/${encodeURIComponent(id)}`).catch(() => null)));
  const analyzedMatches = matches.filter(Boolean).map((match) => summarizeValorantMatch(match, account.puuid, contentNames)).filter(Boolean);

  return {
    game: "valorant",
    account,
    region: region.toUpperCase(),
    updatedAt: new Date().toISOString(),
    apiLimited: false,
    overview: summarizeValorantOverview(analyzedMatches),
    agentPool: summarizeAgentPool(analyzedMatches),
    recentMatches: analyzedMatches
  };
}

async function getAccountByRiotId(riotId, routing) {
  return riotFetch(`https://${routing}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId.gameName)}/${encodeURIComponent(riotId.tagLine)}`);
}

function summarizeLolMatch(match, puuid) {
  const participant = match.info?.participants?.find((player) => player.puuid === puuid);
  if (!participant) return null;
  const durationMinutes = Math.max(1, (match.info.gameDuration || 0) / 60);
  const team = match.info.teams?.find((entry) => entry.teamId === participant.teamId);

  return {
    id: match.metadata.matchId,
    queueId: match.info.queueId,
    mode: queueName(match.info.queueId),
    champion: participant.championName,
    role: participant.teamPosition || participant.individualPosition || "FILL",
    win: Boolean(participant.win),
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    kda: ratio(participant.kills + participant.assists, participant.deaths),
    cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
    csPerMin: ratio(participant.totalMinionsKilled + participant.neutralMinionsKilled, durationMinutes),
    visionScore: participant.visionScore,
    damage: participant.totalDamageDealtToChampions,
    gold: participant.goldEarned,
    killParticipation: percent(participant.kills + participant.assists, team?.objectives?.champion?.kills || 0),
    duration: match.info.gameDuration,
    createdAt: match.info.gameCreation,
    result: participant.win ? "Victory" : "Defeat",
    teamKills: team?.objectives?.champion?.kills || 0
  };
}

function summarizeLolOverview(matches) {
  if (!matches.length) {
    return {
      matches: 0,
      winRate: 0,
      wins: 0,
      losses: 0,
      avgKda: 0,
      avgCsMin: 0,
      avgVision: 0,
      avgDamage: 0,
      avgGold: 0,
      avgKillParticipation: 0,
      avgKills: 0,
      avgDeaths: 0,
      avgAssists: 0
    };
  }

  const totals = matches.reduce((acc, match) => {
    acc.wins += match.win ? 1 : 0;
    acc.kills += match.kills;
    acc.deaths += match.deaths;
    acc.assists += match.assists;
    acc.csMin += match.csPerMin;
    acc.vision += match.visionScore;
    acc.damage += match.damage;
    acc.gold += match.gold;
    acc.killParticipation += match.killParticipation;
    return acc;
  }, { wins: 0, kills: 0, deaths: 0, assists: 0, csMin: 0, vision: 0, damage: 0, gold: 0, killParticipation: 0 });

  return {
    matches: matches.length,
    winRate: percent(totals.wins, matches.length),
    wins: totals.wins,
    losses: matches.length - totals.wins,
    avgKda: ratio(totals.kills + totals.assists, totals.deaths),
    avgCsMin: average(totals.csMin, matches.length),
    avgVision: average(totals.vision, matches.length),
    avgDamage: Math.round(average(totals.damage, matches.length)),
    avgGold: Math.round(average(totals.gold, matches.length)),
    avgKillParticipation: average(totals.killParticipation, matches.length),
    avgKills: average(totals.kills, matches.length),
    avgDeaths: average(totals.deaths, matches.length),
    avgAssists: average(totals.assists, matches.length)
  };
}

function summarizeChampionPool(matches) {
  const byChampion = new Map();
  for (const match of matches) {
    const entry = byChampion.get(match.champion) || { name: match.champion, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, avgDamage: 0 };
    entry.games += 1;
    entry.wins += match.win ? 1 : 0;
    entry.kills += match.kills;
    entry.deaths += match.deaths;
    entry.assists += match.assists;
    entry.avgDamage += match.damage;
    byChampion.set(match.champion, entry);
  }

  return Array.from(byChampion.values())
    .map((entry) => ({
      ...entry,
      winRate: percent(entry.wins, entry.games),
      kda: ratio(entry.kills + entry.assists, entry.deaths),
      avgDamage: Math.round(average(entry.avgDamage, entry.games))
    }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate)
    .slice(0, 6);
}

function summarizeValorantMatch(match, puuid, contentNames) {
  const player = match.players?.find((entry) => entry.puuid === puuid);
  if (!player) return null;
  const team = match.teams?.find((entry) => entry.teamId === player.teamId);
  const rounds = Math.max(1, match.roundResults?.length || (team ? team.roundsPlayed : 0) || 1);
  const stats = player.stats || {};
  const damage = (player.roundDamage || []).reduce((sum, round) => sum + (round.damage || 0), 0);
  const headshots = stats.headshots || 0;
  const bodyshots = stats.bodyshots || 0;
  const legshots = stats.legshots || 0;
  const shots = headshots + bodyshots + legshots;

  return {
    id: match.matchInfo?.matchId,
    queue: titleCase(match.matchInfo?.queueId || "custom"),
    map: contentNames.maps.get(match.matchInfo?.mapId) || titleCase((match.matchInfo?.mapId || "").split("/").pop() || "Unknown"),
    agent: contentNames.characters.get(player.characterId) || "Unknown Agent",
    win: team ? team.won : false,
    kills: stats.kills || 0,
    deaths: stats.deaths || 0,
    assists: stats.assists || 0,
    score: stats.score || 0,
    kda: ratio((stats.kills || 0) + (stats.assists || 0), stats.deaths || 0),
    kd: ratio(stats.kills || 0, stats.deaths || 0),
    acs: Math.round((stats.score || 0) / rounds),
    adr: Math.round(damage / rounds),
    headshotRate: percent(headshots, shots),
    competitiveTier: player.competitiveTier || 0,
    rounds,
    createdAt: match.matchInfo?.gameStartMillis,
    result: team?.won ? "Victory" : "Defeat",
    scoreline: team ? `${team.roundsWon}-${team.roundsLost}` : "-"
  };
}

function summarizeValorantOverview(matches) {
  if (!matches.length) return emptyValorantOverview();
  const totals = matches.reduce((acc, match) => {
    acc.wins += match.win ? 1 : 0;
    acc.kills += match.kills;
    acc.deaths += match.deaths;
    acc.assists += match.assists;
    acc.acs += match.acs;
    acc.adr += match.adr;
    acc.hs += match.headshotRate;
    acc.tier = Math.max(acc.tier, match.competitiveTier || 0);
    return acc;
  }, { wins: 0, kills: 0, deaths: 0, assists: 0, acs: 0, adr: 0, hs: 0, tier: 0 });

  return {
    matches: matches.length,
    winRate: percent(totals.wins, matches.length),
    wins: totals.wins,
    losses: matches.length - totals.wins,
    kd: ratio(totals.kills, totals.deaths),
    kda: ratio(totals.kills + totals.assists, totals.deaths),
    acs: Math.round(average(totals.acs, matches.length)),
    adr: Math.round(average(totals.adr, matches.length)),
    headshotRate: average(totals.hs, matches.length),
    rank: valorantTierName(totals.tier)
  };
}

function emptyValorantOverview() {
  return {
    matches: 0,
    winRate: 0,
    wins: 0,
    losses: 0,
    kd: 0,
    kda: 0,
    acs: 0,
    adr: 0,
    headshotRate: 0,
    rank: "Unrated"
  };
}

function summarizeAgentPool(matches) {
  const byAgent = new Map();
  for (const match of matches) {
    const entry = byAgent.get(match.agent) || { name: match.agent, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, acs: 0 };
    entry.games += 1;
    entry.wins += match.win ? 1 : 0;
    entry.kills += match.kills;
    entry.deaths += match.deaths;
    entry.assists += match.assists;
    entry.acs += match.acs;
    byAgent.set(match.agent, entry);
  }
  return Array.from(byAgent.values()).map((entry) => ({
    ...entry,
    winRate: percent(entry.wins, entry.games),
    kd: ratio(entry.kills, entry.deaths),
    acs: Math.round(average(entry.acs, entry.games))
  })).sort((a, b) => b.games - a.games || b.winRate - a.winRate).slice(0, 6);
}

function summarizeTftMatch(match, puuid) {
  const participant = match.info?.participants?.find((player) => player.puuid === puuid);
  if (!participant) return null;
  const traits = (participant.traits || [])
    .filter((trait) => trait.tier_current > 0)
    .map((trait) => ({
      name: cleanTftName(trait.name),
      units: trait.num_units,
      tier: trait.tier_current,
      maxTier: trait.tier_total
    }))
    .sort((a, b) => b.tier - a.tier || b.units - a.units)
    .slice(0, 6);
  const units = (participant.units || [])
    .map((unit) => ({
      name: cleanTftName(unit.character_id),
      tier: unit.tier || 1,
      rarity: unit.rarity ?? 0,
      items: unit.itemNames || []
    }))
    .sort((a, b) => b.tier - a.tier || b.rarity - a.rarity)
    .slice(0, 8);

  return {
    id: match.metadata?.match_id,
    queueId: match.info?.queue_id,
    mode: tftQueueName(match.info?.queue_id),
    placement: participant.placement,
    result: placementLabel(participant.placement),
    top4: participant.placement <= 4,
    first: participant.placement === 1,
    level: participant.level,
    lastRound: participant.last_round,
    goldLeft: participant.gold_left,
    playersEliminated: participant.players_eliminated,
    damageToPlayers: participant.total_damage_to_players,
    timeEliminated: participant.time_eliminated,
    companion: cleanTftName(participant.companion?.content_ID || ""),
    set: match.info?.tft_set_number,
    gameLength: match.info?.game_length,
    createdAt: match.info?.game_datetime,
    version: match.info?.game_version,
    traits,
    units
  };
}

function summarizeTftOverview(matches) {
  if (!matches.length) {
    return {
      matches: 0,
      avgPlacement: 0,
      top4Rate: 0,
      winRate: 0,
      firsts: 0,
      top4s: 0,
      bottom4s: 0,
      avgLevel: 0,
      avgDamage: 0,
      avgElims: 0,
      avgGold: 0,
      bestPlacement: "-"
    };
  }
  const totals = matches.reduce((acc, match) => {
    acc.placement += match.placement;
    acc.top4 += match.top4 ? 1 : 0;
    acc.firsts += match.first ? 1 : 0;
    acc.level += match.level;
    acc.damage += match.damageToPlayers;
    acc.elims += match.playersEliminated;
    acc.gold += match.goldLeft;
    acc.best = Math.min(acc.best, match.placement);
    return acc;
  }, { placement: 0, top4: 0, firsts: 0, level: 0, damage: 0, elims: 0, gold: 0, best: 8 });

  return {
    matches: matches.length,
    avgPlacement: average(totals.placement, matches.length),
    top4Rate: percent(totals.top4, matches.length),
    winRate: percent(totals.firsts, matches.length),
    firsts: totals.firsts,
    top4s: totals.top4,
    bottom4s: matches.length - totals.top4,
    avgLevel: average(totals.level, matches.length),
    avgDamage: Math.round(average(totals.damage, matches.length)),
    avgElims: average(totals.elims, matches.length),
    avgGold: average(totals.gold, matches.length),
    bestPlacement: `#${totals.best}`
  };
}

function summarizeTftTraits(matches) {
  const byTrait = new Map();
  for (const match of matches) {
    for (const trait of match.traits) {
      const entry = byTrait.get(trait.name) || { name: trait.name, games: 0, top4s: 0, firsts: 0, avgPlacement: 0, avgTier: 0 };
      entry.games += 1;
      entry.top4s += match.top4 ? 1 : 0;
      entry.firsts += match.first ? 1 : 0;
      entry.avgPlacement += match.placement;
      entry.avgTier += trait.tier;
      byTrait.set(trait.name, entry);
    }
  }
  return Array.from(byTrait.values())
    .map((entry) => ({
      ...entry,
      top4Rate: percent(entry.top4s, entry.games),
      winRate: percent(entry.firsts, entry.games),
      avgPlacement: average(entry.avgPlacement, entry.games),
      avgTier: average(entry.avgTier, entry.games)
    }))
    .sort((a, b) => b.games - a.games || b.top4Rate - a.top4Rate)
    .slice(0, 8);
}

function summarizeTftUnits(matches) {
  const byUnit = new Map();
  for (const match of matches) {
    for (const unit of match.units) {
      const entry = byUnit.get(unit.name) || { name: unit.name, games: 0, top4s: 0, firsts: 0, avgPlacement: 0, avgTier: 0 };
      entry.games += 1;
      entry.top4s += match.top4 ? 1 : 0;
      entry.firsts += match.first ? 1 : 0;
      entry.avgPlacement += match.placement;
      entry.avgTier += unit.tier;
      byUnit.set(unit.name, entry);
    }
  }
  return Array.from(byUnit.values())
    .map((entry) => ({
      ...entry,
      top4Rate: percent(entry.top4s, entry.games),
      winRate: percent(entry.firsts, entry.games),
      avgPlacement: average(entry.avgPlacement, entry.games),
      avgTier: average(entry.avgTier, entry.games)
    }))
    .sort((a, b) => b.games - a.games || b.top4Rate - a.top4Rate)
    .slice(0, 8);
}

function formatLeagueEntry(entry) {
  return {
    queueType: entry.queueType,
    tier: entry.tier,
    rank: entry.rank,
    leaguePoints: entry.leaguePoints,
    wins: entry.wins,
    losses: entry.losses,
    winRate: percent(entry.wins, entry.wins + entry.losses),
    hotStreak: entry.hotStreak,
    veteran: entry.veteran
  };
}

function formatTftEntry(entry) {
  return {
    queueType: entry.queueType,
    tier: entry.tier,
    rank: entry.rank,
    leaguePoints: entry.leaguePoints,
    wins: entry.wins,
    losses: entry.losses,
    winRate: percent(entry.wins, entry.wins + entry.losses),
    ratedTier: entry.ratedTier,
    ratedRating: entry.ratedRating
  };
}

async function riotFetch(url) {
  const response = await fetch(url, {
    headers: {
      "X-Riot-Token": RIOT_API_KEY,
      "Accept": "application/json"
    }
  });
  if (!response.ok) {
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    const message = body.status?.message || `Riot API request failed with ${response.status}`;
    throw publicError(response.status, message);
  }
  return response.json();
}

async function exchangeRsoCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: RSO_REDIRECT_URI
  });
  const response = await fetch("https://auth.riotgames.com/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${RSO_CLIENT_ID}:${RSO_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body
  });
  if (!response.ok) {
    throw publicError(response.status, "RSO token exchange failed.");
  }
  return response.json();
}

async function fetchRsoAccount(accessToken) {
  const response = await fetch(`https://${DEFAULT_ROUTING}.api.riotgames.com/riot/account/v1/accounts/me`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json"
    }
  });
  if (!response.ok) {
    throw publicError(response.status, "Could not verify the linked Riot account.");
  }
  const account = await response.json();
  return {
    puuid: account.puuid,
    gameName: account.gameName,
    tagLine: account.tagLine
  };
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.normalize(path.join(publicDir, safePath));
  if (resolved !== publicDir && !resolved.startsWith(`${publicDir}${path.sep}`)) {
    throw publicError(403, "Forbidden.");
  }
  try {
    const content = await fs.readFile(resolved);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(resolved)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(content);
  } catch {
    const content = await fs.readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(content);
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function hasRsoConfig() {
  return Boolean(RSO_CLIENT_ID && RSO_CLIENT_SECRET && RSO_REDIRECT_URI);
}

function createSession(session) {
  const sessionId = signSessionId(crypto.randomBytes(32).toString("hex"));
  sessions.set(sessionId, {
    account: session.account,
    createdAt: Date.now()
  });
  pruneSessions();
  return sessionId;
}

function getSession(req) {
  const sessionId = parseCookies(req.headers.cookie || "").rgt_session;
  if (!sessionId || !verifySignedSessionId(sessionId)) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > 1000 * 60 * 60 * 24 * 14) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function signSessionId(id) {
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(id).digest("base64url");
  return `${id}.${signature}`;
}

function verifySignedSessionId(value) {
  const [id, signature] = String(value).split(".");
  if (!id || !signature) return false;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(id).digest("base64url");
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/"];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  appendSetCookie(res, parts.join("; "));
}

function clearCookie(res, name, options = {}) {
  const parts = [`${name}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (options.secure) parts.push("Secure");
  appendSetCookie(res, parts.join("; "));
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  res.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]);
}

function parseCookies(header) {
  return Object.fromEntries(String(header).split(";").map((part) => {
    const index = part.indexOf("=");
    if (index === -1) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function isSecureRequest(req) {
  return req.headers["x-forwarded-proto"] === "https" || String(req.headers.host || "").endsWith(".vercel.app");
}

function safeReturnPath(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "";
  return value;
}

function appendQuery(pathname, key, value) {
  const url = new URL(pathname, "http://local.rgtracker");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function pruneRsoStates() {
  const cutoff = Date.now() - 1000 * 60 * 10;
  for (const [state, value] of rsoStates) {
    if (value.createdAt < cutoff) rsoStates.delete(state);
  }
}

function pruneSessions() {
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 14;
  for (const [sessionId, value] of sessions) {
    if (value.createdAt < cutoff) sessions.delete(sessionId);
  }
}

function parseRiotId(value) {
  const raw = String(value || "").trim();
  const separator = raw.includes("#") ? "#" : raw.includes("-") ? "-" : "";
  if (!separator) {
    throw publicError(400, "Enter a Riot ID as gameName#tagLine.");
  }
  const [gameName, tagLine] = raw.split(separator);
  if (!gameName || !tagLine) {
    throw publicError(400, "Enter a Riot ID as gameName#tagLine.");
  }
  return { gameName: gameName.trim(), tagLine: tagLine.trim() };
}

function sameRiotId(left, right) {
  return normalizeRiotIdPart(left.gameName) === normalizeRiotIdPart(right.gameName)
    && normalizeRiotIdPart(left.tagLine) === normalizeRiotIdPart(right.tagLine);
}

function normalizeRiotIdPart(value) {
  return String(value || "").trim().toLowerCase();
}

function publicError(status, publicMessage) {
  const error = new Error(publicMessage);
  error.status = status;
  error.publicMessage = publicMessage;
  return error;
}

function ratio(numerator, denominator) {
  if (!denominator) return Number(numerator.toFixed ? numerator.toFixed(2) : numerator);
  return Number((numerator / denominator).toFixed(2));
}

function average(total, count) {
  if (!count) return 0;
  return Number((total / count).toFixed(1));
}

function percent(value, total) {
  if (!total) return 0;
  return Number(((value / total) * 100).toFixed(1));
}

function queuePriority(queue) {
  return queue === "RANKED_SOLO_5x5" ? 0 : queue === "RANKED_FLEX_SR" ? 1 : 2;
}

function queueName(queueId) {
  const names = {
    420: "Ranked Solo",
    440: "Ranked Flex",
    400: "Normal Draft",
    430: "Normal Blind",
    450: "ARAM",
    700: "Clash",
    1700: "Arena"
  };
  return names[queueId] || `Queue ${queueId}`;
}

function tftQueueName(queueId) {
  const names = {
    1090: "Normal",
    1100: "Ranked",
    1110: "Tutorial",
    1130: "Hyper Roll",
    1150: "Double Up",
    1160: "Double Up Workshop"
  };
  return names[queueId] || `Queue ${queueId}`;
}

function placementLabel(placement) {
  if (!placement) return "-";
  const suffix = placement === 1 ? "st" : placement === 2 ? "nd" : placement === 3 ? "rd" : "th";
  return `${placement}${suffix}`;
}

function cleanTftName(value) {
  return titleCase(String(value || "Unknown")
    .replace(/^TFT\d+_/i, "")
    .replace(/^Characters_?/i, "")
    .replace(/^Items_?/i, "")
    .replace(/^Augment_?/i, "")
    .replace(/_/g, " "));
}

function titleCase(value) {
  return String(value || "").replace(/[_-]+/g, " ").replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
}

function normalizeValorantRegion(routing) {
  if (routing === "europe") return "eu";
  if (routing === "asia") return "ap";
  if (routing === "sea") return "ap";
  return "na";
}

function valorantTierName(tier) {
  const names = {
    0: "Unrated",
    3: "Iron 1",
    4: "Iron 2",
    5: "Iron 3",
    6: "Bronze 1",
    7: "Bronze 2",
    8: "Bronze 3",
    9: "Silver 1",
    10: "Silver 2",
    11: "Silver 3",
    12: "Gold 1",
    13: "Gold 2",
    14: "Gold 3",
    15: "Platinum 1",
    16: "Platinum 2",
    17: "Platinum 3",
    18: "Diamond 1",
    19: "Diamond 2",
    20: "Diamond 3",
    21: "Ascendant 1",
    22: "Ascendant 2",
    23: "Ascendant 3",
    24: "Immortal 1",
    25: "Immortal 2",
    26: "Immortal 3",
    27: "Radiant"
  };
  return names[tier] || "Unrated";
}

function mapValorantContent(content) {
  const maps = new Map();
  const characters = new Map();
  for (const map of content?.maps || []) {
    maps.set(map.id, map.name);
  }
  for (const character of content?.characters || []) {
    characters.set(character.id, character.name);
  }
  return { maps, characters };
}

function loadEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    const content = requireEnvFile(envPath);
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional; production hosts typically provide environment variables.
  }
}

function requireEnvFile(envPath) {
  return syncFs.readFileSync(envPath, "utf8");
}
