const landingForm = document.querySelector("#landingSearchForm");
const landingInput = document.querySelector("#riotId");
const profileForm = document.querySelector("#profileSearchForm");
const profileInput = document.querySelector("#profileRiotId");
const home = document.querySelector("#home");
const profile = document.querySelector("#profile");
const loading = document.querySelector("#loading");
const errorBanner = document.querySelector("#errorBanner");
const profileContent = document.querySelector("#profileContent");

const gameLabel = document.querySelector("#gameLabel");
const profileTitle = document.querySelector("#profileTitle");
const profileSubtitle = document.querySelector("#profileSubtitle");
const updatedAt = document.querySelector("#updatedAt");
const summaryBand = document.querySelector("#summaryBand");
const rankPanel = document.querySelector("#rankPanel");
const poolTitle = document.querySelector("#poolTitle");
const poolCaption = document.querySelector("#poolCaption");
const poolList = document.querySelector("#poolList");
const matchCaption = document.querySelector("#matchCaption");
const matchList = document.querySelector("#matchList");

let selectedGame = "valorant";
let activeGame = "valorant";
let activeController = null;

document.querySelectorAll("[data-game]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedGame = button.dataset.game;
  });
});

landingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const riotId = landingInput.value.trim();
  if (!riotId) {
    showLandingError("Enter a Riot ID first.");
    return;
  }
  navigateToProfile(selectedGame, riotId);
});

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const submitterGame = event.submitter?.dataset.profileGame;
  const game = submitterGame || activeGame;
  const riotId = profileInput.value.trim();
  if (!riotId) {
    showProfileError("Enter a Riot ID first.");
    return;
  }
  navigateToProfile(game, riotId);
});

window.addEventListener("popstate", () => {
  routeFromLocation(false);
});

routeFromLocation(false);

function routeFromLocation(push = false) {
  const game = gameFromPath(location.pathname);
  const riotId = new URLSearchParams(location.search).get("riotId");
  if (game && riotId) {
    loadProfile(game, riotId, push);
    return;
  }
  showLanding();
}

function navigateToProfile(game, riotId) {
  const safeGame = game === "valorant" ? "valorant" : game === "tft" ? "tft" : "league";
  history.pushState({}, "", `/${safeGame}?riotId=${encodeURIComponent(riotId)}`);
  loadProfile(safeGame, riotId, false);
}

async function loadProfile(game, riotId) {
  activeGame = game;
  selectedGame = game;
  showProfileShell(game, riotId);

  if (activeController) activeController.abort();
  activeController = new AbortController();

  try {
    if (game === "valorant") {
      await loadValorantProfile(riotId);
      return;
    }
    const response = await fetch(`/api/profile/${game}?riotId=${encodeURIComponent(riotId)}`, {
      signal: activeController.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load profile.");
    renderProfile(data);
  } catch (error) {
    if (error.name === "AbortError") return;
    showProfileError(error.message);
  }
}

async function loadValorantProfile(riotId) {
  const sessionResponse = await fetch("/api/auth/session", { signal: activeController.signal });
  const session = await sessionResponse.json();
  if (!session.authenticated) {
    renderValorantGate(riotId, session);
    return;
  }
  const linkedRiotId = `${session.account.gameName}#${session.account.tagLine}`;
  if (normalizeRiotId(riotId) !== normalizeRiotId(linkedRiotId)) {
    renderValorantMismatch(riotId, linkedRiotId);
    return;
  }
  const response = await fetch(`/api/profile/valorant?riotId=${encodeURIComponent(linkedRiotId)}`, {
    signal: activeController.signal
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load Valorant profile.");
  renderProfile(data);
}

function showLanding() {
  home.hidden = false;
  profile.hidden = true;
  errorBanner.hidden = true;
  profileContent.hidden = true;
  document.body.classList.remove("is-profile-page");
}

function showProfileShell(game, riotId) {
  home.hidden = true;
  profile.hidden = false;
  loading.hidden = false;
  errorBanner.hidden = true;
  profileContent.hidden = true;
  document.body.classList.add("is-profile-page");
  profileInput.value = riotId;
  landingInput.value = riotId;
  setProfileGameButtons(game);
  gameLabel.textContent = gameLabelFor(game);
  profileTitle.textContent = riotId;
  profileSubtitle.textContent = "Loading account, rank, recent match, and performance data.";
  updatedAt.textContent = "";
}

function renderProfile(data) {
  loading.hidden = true;
  profileContent.hidden = false;
  profileTitle.textContent = `${data.account.gameName}#${data.account.tagLine}`;
  profileSubtitle.textContent = data.game === "league"
    ? `${data.region} · Level ${data.summoner?.level ?? "-"}`
    : data.game === "tft"
      ? `${data.region}${data.summoner?.level ? ` · Level ${data.summoner.level}` : ""}`
      : `${data.region} · ${data.overview.rank}`;
  updatedAt.textContent = `Updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

  if (data.apiLimited) {
    errorBanner.hidden = false;
    errorBanner.textContent = data.message;
  } else {
    errorBanner.hidden = true;
  }

  renderSummary(data);
  renderRanks(data);
  renderPool(data);
  renderMatches(data);
}

function renderSummary(data) {
  const stats = summaryStatsFor(data);

  summaryBand.innerHTML = stats.map(([label, value]) => `
    <div class="stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function renderRanks(data) {
  if (data.game === "league" || data.game === "tft") {
    if (!data.ranked.length) {
      rankPanel.innerHTML = `<div class="empty">No ranked entries found.</div>`;
      return;
    }
    rankPanel.innerHTML = data.ranked.map((entry) => `
      <div class="rank-card">
        <div>
          <strong>${escapeHtml(data.game === "tft" ? tftRankQueue(entry.queueType) : rankQueue(entry.queueType))}</strong>
          <span class="pool-meta">${escapeHtml(entry.tier)} ${escapeHtml(entry.rank)} · ${entry.leaguePoints} LP</span>
        </div>
        <div class="pool-meta">${entry.wins}W ${entry.losses}L · ${entry.winRate}%</div>
      </div>
    `).join("");
    return;
  }

  rankPanel.innerHTML = `
    <div class="rank-card">
      <div>
        <strong>${escapeHtml(data.overview.rank)}</strong>
        <span class="pool-meta">Estimated from accessible match data</span>
      </div>
      <div class="pool-meta">${data.overview.wins}W ${data.overview.losses}L</div>
    </div>
    <div class="rank-card">
      <div>
        <strong>${data.overview.acs} ACS</strong>
        <span class="pool-meta">${data.overview.adr} ADR · ${data.overview.kda} KDA</span>
      </div>
      <div class="pool-meta">${data.overview.headshotRate}% HS</div>
    </div>
  `;
}

function renderPool(data) {
  if (data.game === "tft") {
    renderTftPools(data);
    return;
  }
  if (data.game === "league") {
    renderLeaguePools(data);
    return;
  }
  const items = data.game === "league" ? data.championPool : data.game === "tft" ? data.traitPool : data.agentPool;
  poolTitle.textContent = data.game === "league" ? "Champion Pool" : data.game === "tft" ? "Trait Pool" : "Agent Pool";
  poolCaption.textContent = items.length ? `${items.length} picks` : "";
  if (!items.length) {
    poolList.innerHTML = `<div class="empty">No pick data available yet.</div>`;
    return;
  }
  poolList.innerHTML = items.map((item) => `
    <div class="pool-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span class="pool-meta">${item.games} games · ${data.game === "tft" ? `${item.top4Rate}% top 4` : `${item.winRate}% win`}</span>
      </div>
      <span>${data.game === "league" ? item.kda + " KDA" : data.game === "tft" ? "#" + item.avgPlacement : item.kd + " K/D"}</span>
      <span>${data.game === "league" ? formatNumber(item.avgDamage) + " dmg" : data.game === "tft" ? item.winRate + "% win" : item.acs + " ACS"}</span>
    </div>
  `).join("");
}

function renderLeaguePools(data) {
  poolTitle.textContent = "Champions & Roles";
  poolCaption.textContent = `${data.championPool.length} champions`;
  const roles = data.overview.roleDistribution || [];
  const roleRows = roles.map((role) => `
    <div class="role-chip">
      <strong>${escapeHtml(role.role)}</strong>
      <span>${role.games} games · ${role.rate}%</span>
    </div>
  `).join("");
  const championRows = data.championPool.map((item) => `
    <div class="champion-row">
      <div class="champion-face">${championInitial(item.name)}</div>
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span class="pool-meta">${item.games} games · ${item.primaryRole} · ${item.avgCs} CS (${item.avgCsMin}/m)</span>
      </div>
      <div class="champion-stat">
        <strong>${item.kda}:1</strong>
        <span>${item.avgKills}/${item.avgDeaths}/${item.avgAssists}</span>
      </div>
      <div class="champion-stat">
        <strong>${item.winRate}%</strong>
        <span>${item.avgKillParticipation}% KP</span>
      </div>
      <div class="champion-stat">
        <strong>${formatNumber(item.avgDamage)}</strong>
        <span>dmg</span>
      </div>
    </div>
  `).join("");
  poolList.innerHTML = `
    <div class="role-grid">${roleRows || `<div class="empty">No role data available yet.</div>`}</div>
    <div class="pool-subhead">Recent Champion Performance</div>
    ${championRows || `<div class="empty">No champion data available yet.</div>`}
  `;
}

function renderTftPools(data) {
  poolTitle.textContent = "TFT Pools";
  poolCaption.textContent = `${data.traitPool.length} traits · ${data.unitPool.length} units`;
  const traits = data.traitPool.map((item) => `
    <div class="pool-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span class="pool-meta">${item.games} games · ${item.top4Rate}% top 4 · tier ${item.avgTier}</span>
      </div>
      <span>#${item.avgPlacement}</span>
      <span>${item.winRate}% win</span>
    </div>
  `).join("");
  const units = data.unitPool.map((item) => `
    <div class="pool-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span class="pool-meta">${item.games} games · ${item.top4Rate}% top 4 · ${item.avgTier} star avg</span>
      </div>
      <span>#${item.avgPlacement}</span>
      <span>${item.winRate}% win</span>
    </div>
  `).join("");
  poolList.innerHTML = `
    <div class="pool-subhead">Traits</div>
    ${traits || `<div class="empty">No trait data available yet.</div>`}
    <div class="pool-subhead">Units</div>
    ${units || `<div class="empty">No unit data available yet.</div>`}
  `;
}

function renderMatches(data) {
  const matches = data.recentMatches || [];
  matchCaption.textContent = matches.length ? `${matches.length} matches` : "";
  if (!matches.length) {
    matchList.innerHTML = `<div class="empty">No recent matches available.</div>`;
    return;
  }

  matchList.innerHTML = matches.map((match) => {
    const lossClass = match.win ? "" : " result--loss";
    if (data.game === "league") {
      return renderLeagueMatch(match);
    }
    if (data.game === "tft") {
      return `
        <div class="match-row match-row--tft">
          <span class="result${match.top4 ? "" : " result--loss"}">${match.result}</span>
          <div>
            <strong>${escapeHtml(match.mode)}</strong>
            <span class="match-meta">Set ${escapeHtml(match.set ?? "-")} · Level ${escapeHtml(match.level)} · Round ${escapeHtml(match.lastRound)}</span>
          </div>
          <span>${formatNumber(match.damageToPlayers)} dmg</span>
          <span>${match.playersEliminated} elim</span>
        </div>
      `;
    }
    return `
      <div class="match-row">
        <span class="result${lossClass}">${match.result}</span>
        <div>
          <strong>${escapeHtml(match.agent)}</strong>
          <span class="match-meta">${escapeHtml(match.map)} · ${escapeHtml(match.queue)} · ${match.scoreline}</span>
        </div>
        <span>${match.kills}/${match.deaths}/${match.assists}</span>
        <span>${match.acs} ACS</span>
      </div>
    `;
  }).join("");
}

function renderLeagueMatch(match) {
  return `
    <article class="league-match-card ${match.win ? "league-match-card--win" : "league-match-card--loss"}">
      <div class="league-match-summary">
        <div class="league-match-meta">
          <strong>${escapeHtml(match.mode)}</strong>
          <span>${escapeHtml(match.result)}</span>
          <span>${formatDuration(match.duration)}</span>
          <span>${match.participantCount} players</span>
        </div>
        <div class="league-match-main">
          <div class="champion-face champion-face--large">${championInitial(match.champion)}</div>
          <div>
            <strong>${escapeHtml(match.champion)}</strong>
            <span class="match-meta">${escapeHtml(match.role)} · ${match.items.length} items</span>
            <div class="item-row">${renderItemSlots(match.items)}</div>
          </div>
        </div>
        <div class="league-kda">
          <strong>${match.kills}<span>/</span>${match.deaths}<span>/</span>${match.assists}</strong>
          <small>${match.kda}:1 KDA</small>
          ${multiKillBadge(match)}
        </div>
        <div class="league-extra">
          <span>P/Kill ${match.killParticipation}%</span>
          <span>CS ${match.cs} (${match.csPerMin}/m)</span>
          <span>Vision ${match.visionScore} · Wards ${match.wardsPlaced}/${match.wardsKilled}</span>
          <span>Damage ${formatNumber(match.damage)} (${match.damageShare}%)</span>
          <span>Gold ${formatNumber(match.gold)} (${match.goldShare}%)</span>
        </div>
        <div class="objective-row">
          <span>Towers ${match.teamObjectives?.towers ?? 0}</span>
          <span>Dragons ${match.teamObjectives?.dragons ?? 0}</span>
          <span>Barons ${match.teamObjectives?.barons ?? 0}</span>
          <span>Inhibs ${match.teamObjectives?.inhibitors ?? 0}</span>
        </div>
      </div>
      <div class="match-scoreboard">${renderScoreboard(match)}</div>
    </article>
  `;
}

function renderScoreboard(match) {
  return (match.participantTeams || []).map((team) => `
    <section class="scoreboard-team ${team.won ? "scoreboard-team--win" : "scoreboard-team--loss"}">
      <header class="scoreboard-team__header">
        <strong>${escapeHtml(team.label)}</strong>
        <span>${team.totals.kills}/${team.totals.deaths}/${team.totals.assists}</span>
        <span>${formatNumber(team.totals.damage)} dmg</span>
        <span>${formatNumber(team.totals.gold)} gold</span>
        ${team.objectives ? `<span>D ${team.objectives.dragons} · B ${team.objectives.barons} · T ${team.objectives.towers}</span>` : ""}
      </header>
      <div class="scoreboard-table">
        <div class="scoreboard-row scoreboard-row--head">
          <span>Player</span>
          <span>KDA</span>
          <span>Damage</span>
          <span>Gold</span>
          <span>CS</span>
          <span>Wards</span>
          <span>Build</span>
        </div>
        ${team.players.map((player) => renderScoreboardPlayer(player, match.accountPuuid)).join("")}
      </div>
    </section>
  `).join("");
}

function renderScoreboardPlayer(player, currentPuuid) {
  const isCurrentPlayer = player.puuid && player.puuid === currentPuuid;
  return `
    <div class="scoreboard-row ${isCurrentPlayer ? "scoreboard-row--current" : ""}">
      <div class="scoreboard-player">
        <div class="champion-face">${championInitial(player.champion)}</div>
        <div>
          <strong title="${escapeHtml(player.riotId)}">${escapeHtml(truncateName(player.riotId))}</strong>
          <span>${escapeHtml(player.champion)} · Lv ${player.level} · ${escapeHtml(player.role)}</span>
          <div class="spell-row">${[...(player.summonerSpells || []), ...(player.perks || [])].slice(0, 4).map((id) => `<i>${id}</i>`).join("")}</div>
        </div>
      </div>
      <div><strong>${player.kills}/${player.deaths}/${player.assists}</strong><span>${player.kda}:1</span></div>
      <div><strong>${formatNumber(player.damage)}</strong><span>${formatNumber(player.damageTaken)} taken</span></div>
      <div><strong>${formatNumber(player.gold)}</strong></div>
      <div><strong>${player.cs}</strong><span>${player.csPerMin}/m</span></div>
      <div><strong>${player.visionScore}</strong><span>${player.wardsPlaced}/${player.wardsKilled}</span></div>
      <div class="item-row item-row--scoreboard">${renderItemSlots(player.items)}</div>
    </div>
  `;
}

function renderItemSlots(items) {
  const slots = [...(items || [])];
  while (slots.length < 7) slots.push("");
  return slots.slice(0, 7).map((item) => `<span class="${item ? "" : "is-empty"}">${item || ""}</span>`).join("");
}

function multiKillBadge(match) {
  if (match.pentaKills) return `<em class="kill-badge">Penta kill</em>`;
  if (match.quadraKills) return `<em class="kill-badge">Quadra kill</em>`;
  if (match.tripleKills) return `<em class="kill-badge">Triple kill</em>`;
  if (match.doubleKills) return `<em class="kill-badge">Double kill</em>`;
  return "";
}

function truncateName(value) {
  const raw = String(value || "Unknown");
  return raw.length > 18 ? `${raw.slice(0, 16)}...` : raw;
}

function showLandingError(message) {
  landingInput.setCustomValidity(message);
  landingInput.reportValidity();
  landingInput.setCustomValidity("");
}

function showProfileError(message) {
  loading.hidden = true;
  profileContent.hidden = true;
  errorBanner.hidden = false;
  errorBanner.textContent = message;
}

function renderValorantGate(riotId, session) {
  const rsoIssue = new URLSearchParams(location.search).get("rso");
  loading.hidden = true;
  errorBanner.hidden = !rsoIssue;
  errorBanner.textContent = rsoIssue ? rsoMessage(rsoIssue) : "";
  profileContent.hidden = false;
  profileTitle.textContent = riotId;
  profileSubtitle.textContent = "Valorant stats require player opt-in before RGTracker can display them.";
  updatedAt.textContent = session.rsoConfigured ? "RSO required" : "RSO setup needed";
  summaryBand.innerHTML = `
    <div class="stat">
      <span>Status</span>
      <strong>Private</strong>
    </div>
    <div class="stat">
      <span>Requirement</span>
      <strong>RSO Opt-in</strong>
    </div>
  `;
  rankPanel.innerHTML = `
    <div class="consent-panel">
      <h3>Connect Riot Account</h3>
      <p>RGTracker only displays VALORANT stats for players who sign in with Riot and opt in to sharing their data. Account linking may make your VALORANT stats visible on this site.</p>
      ${session.rsoConfigured
        ? `<a class="connect-button" href="/auth/riot/start?returnTo=${encodeURIComponent(`/valorant?riotId=${riotId}`)}">Connect with Riot</a>`
        : `<p class="setup-warning">RSO client credentials are not configured yet. Add them in Vercel environment variables after Riot enables RSO for this app.</p>`}
    </div>
  `;
  poolTitle.textContent = "Opt-in Policy";
  poolCaption.textContent = "";
  poolList.innerHTML = `
    <div class="empty">Players who have not linked their Riot account will not have VALORANT stats shown here or exposed to other users.</div>
  `;
  matchCaption.textContent = "";
  matchList.innerHTML = `<div class="empty">Match history appears after the player links this Riot account.</div>`;
}

function renderValorantMismatch(requestedRiotId, linkedRiotId) {
  loading.hidden = true;
  errorBanner.hidden = false;
  errorBanner.textContent = "This VALORANT profile has not opted in through RGTracker.";
  profileContent.hidden = false;
  profileTitle.textContent = requestedRiotId;
  profileSubtitle.textContent = `Signed in as ${linkedRiotId}. VALORANT stats can only be displayed for the linked account.`;
  updatedAt.textContent = "Opt-in required";
  summaryBand.innerHTML = `
    <div class="stat">
      <span>Requested</span>
      <strong>${escapeHtml(requestedRiotId)}</strong>
    </div>
    <div class="stat">
      <span>Linked</span>
      <strong>${escapeHtml(linkedRiotId)}</strong>
    </div>
  `;
  rankPanel.innerHTML = `
    <div class="consent-panel">
      <h3>Private Until Linked</h3>
      <p>RGTracker does not reveal another player's VALORANT stats unless that player signs in and opts in first.</p>
      <a class="connect-button connect-button--secondary" href="/auth/logout">Sign out</a>
    </div>
  `;
  poolTitle.textContent = "Privacy";
  poolCaption.textContent = "";
  poolList.innerHTML = `<div class="empty">Search League or TFT publicly, or ask this Valorant player to opt in.</div>`;
  matchCaption.textContent = "";
  matchList.innerHTML = `<div class="empty">No VALORANT match history is available for non-opted-in accounts.</div>`;
}

function setProfileGameButtons(game) {
  document.querySelectorAll("[data-profile-game]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.profileGame === game);
  });
}

function gameFromPath(pathname) {
  const path = pathname.replace(/^\/+|\/+$/g, "");
  if (path === "league" || path === "valorant" || path === "tft") return path;
  return "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function rankQueue(queueType) {
  return queueType === "RANKED_SOLO_5x5" ? "Ranked Solo/Duo" : queueType === "RANKED_FLEX_SR" ? "Ranked Flex" : queueType;
}

function tftRankQueue(queueType) {
  return queueType === "RANKED_TFT" ? "Ranked TFT" : queueType === "RANKED_TFT_DOUBLE_UP" ? "Double Up" : queueType === "RANKED_TFT_TURBO" ? "Hyper Roll" : queueType;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDuration(seconds) {
  const mins = Math.floor((seconds || 0) / 60);
  const secs = Math.floor((seconds || 0) % 60);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function championInitial(name) {
  return String(name || "?").slice(0, 1).toUpperCase();
}

function normalizeRiotId(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function rsoMessage(issue) {
  const messages = {
    not_configured: "RSO is not configured yet. Add Riot RSO client credentials before live VALORANT account linking.",
    invalid_state: "The Riot sign-in session expired. Please start the connection flow again.",
    token_exchange_failed: "Riot sign-in could not be completed. Please verify the RSO redirect URI and client credentials."
  };
  return messages[issue] || `Riot sign-in returned: ${issue}`;
}

function gameLabelFor(game) {
  if (game === "league") return "League of Legends";
  if (game === "tft") return "Teamfight Tactics";
  return "Valorant";
}

function summaryStatsFor(data) {
  if (data.game === "tft") {
    return [
      ["Matches", data.overview.matches],
      ["Avg Place", data.overview.avgPlacement],
      ["Top 4", `${data.overview.top4Rate}%`],
      ["Wins", data.overview.firsts],
      ["Best", data.overview.bestPlacement],
      ["Avg Level", data.overview.avgLevel],
      ["Avg Damage", formatNumber(data.overview.avgDamage)],
      ["Avg Elims", data.overview.avgElims],
      ["Avg Gold", data.overview.avgGold],
      ["Bottom 4", data.overview.bottom4s]
    ];
  }
  if (data.game === "league") {
    return [
      ["Matches", data.overview.matches],
      ["Win Rate", `${data.overview.winRate}%`],
      ["Record", `${data.overview.wins}W ${data.overview.losses}L`],
      ["Avg KDA", data.overview.avgKda],
      ["Avg K / D / A", `${data.overview.avgKills}/${data.overview.avgDeaths}/${data.overview.avgAssists}`],
      ["Main Role", data.overview.preferredRole],
      ["CS / Min", data.overview.avgCsMin],
      ["Avg Vision", data.overview.avgVision],
      ["Wards", `${data.overview.avgWardsPlaced}/${data.overview.avgWardsKilled}`],
      ["Kill Part.", `${data.overview.avgKillParticipation}%`],
      ["Damage Share", `${data.overview.avgDamageShare}%`],
      ["Gold Share", `${data.overview.avgGoldShare}%`],
      ["Avg Gold", formatNumber(data.overview.avgGold)],
      ["Avg Damage", formatNumber(data.overview.avgDamage)]
    ];
  }
  return [
    ["Matches", data.overview.matches],
    ["Win Rate", `${data.overview.winRate}%`],
    ["Record", `${data.overview.wins}W ${data.overview.losses}L`],
    ["K/D", data.overview.kd],
    ["ACS", data.overview.acs],
    ["HS%", `${data.overview.headshotRate}%`]
  ];
}
