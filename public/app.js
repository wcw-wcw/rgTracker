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
  const safeGame = "league";
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
  gameLabel.textContent = game === "league" ? "League of Legends" : "Valorant";
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
  const stats = data.game === "league"
    ? [
        ["Matches", data.overview.matches],
        ["Win Rate", `${data.overview.winRate}%`],
        ["Record", `${data.overview.wins}W ${data.overview.losses}L`],
        ["Avg KDA", data.overview.avgKda],
        ["CS / Min", data.overview.avgCsMin],
        ["Avg Damage", formatNumber(data.overview.avgDamage)]
      ]
    : [
        ["Matches", data.overview.matches],
        ["Win Rate", `${data.overview.winRate}%`],
        ["Record", `${data.overview.wins}W ${data.overview.losses}L`],
        ["K/D", data.overview.kd],
        ["ACS", data.overview.acs],
        ["HS%", `${data.overview.headshotRate}%`]
      ];

  summaryBand.innerHTML = stats.map(([label, value]) => `
    <div class="stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function renderRanks(data) {
  if (data.game === "league") {
    if (!data.ranked.length) {
      rankPanel.innerHTML = `<div class="empty">No ranked entries found.</div>`;
      return;
    }
    rankPanel.innerHTML = data.ranked.map((entry) => `
      <div class="rank-card">
        <div>
          <strong>${escapeHtml(rankQueue(entry.queueType))}</strong>
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
  const items = data.game === "league" ? data.championPool : data.agentPool;
  poolTitle.textContent = data.game === "league" ? "Champion Pool" : "Agent Pool";
  poolCaption.textContent = items.length ? `${items.length} picks` : "";
  if (!items.length) {
    poolList.innerHTML = `<div class="empty">No pick data available yet.</div>`;
    return;
  }
  poolList.innerHTML = items.map((item) => `
    <div class="pool-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span class="pool-meta">${item.games} games · ${item.winRate}% win</span>
      </div>
      <span>${data.game === "league" ? item.kda : item.kd} ${data.game === "league" ? "KDA" : "K/D"}</span>
      <span>${data.game === "league" ? formatNumber(item.avgDamage) + " dmg" : item.acs + " ACS"}</span>
    </div>
  `).join("");
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
  if (path === "league" || path === "valorant") return path;
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

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function buildTrackerValorantUrl(riotId) {
  const normalized = riotId.replace(/\s+/g, "");
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(normalized)}/overview`;
}
