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
    if (game === "valorant") {
      location.replace(buildTrackerValorantUrl(riotId));
      return;
    }
    loadProfile(game, riotId, push);
    return;
  }
  showLanding();
}

function navigateToProfile(game, riotId) {
  if (game === "valorant") {
    location.href = buildTrackerValorantUrl(riotId);
    return;
  }
  const safeGame = game === "tft" ? "tft" : "league";
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
      return `
        <div class="match-row">
          <span class="result${lossClass}">${match.result}</span>
          <div>
            <strong>${escapeHtml(match.champion)}</strong>
            <span class="match-meta">${escapeHtml(match.mode)} · ${escapeHtml(match.role)}</span>
          </div>
          <span>${match.kills}/${match.deaths}/${match.assists}</span>
          <span>${match.csPerMin} CS/min</span>
        </div>
      `;
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
      ["CS / Min", data.overview.avgCsMin],
      ["Avg Vision", data.overview.avgVision],
      ["Kill Part.", `${data.overview.avgKillParticipation}%`],
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

function buildTrackerValorantUrl(riotId) {
  const normalized = riotId.replace(/\s+/g, "");
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(normalized)}/overview`;
}
