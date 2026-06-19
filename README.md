# RGTracker

A lightweight Riot ID search site for Valorant and League of Legends profiles.

## Run locally

```bash
cp .env.example .env
# Add your Riot developer key to .env
npm run dev
```

Open `http://127.0.0.1:5173`.

## Notes

- Riot IDs should be entered as `gameName#tagLine`, for example `kappa#44444`.
- League data is aggregated from Account-V1, Summoner-V4, League-V4, and Match-V5.
- Valorant match history and ranked data depend on the access level Riot grants to your API key. If the key cannot access VAL-MATCH-V1, the app shows the account card and a clear API access message.
