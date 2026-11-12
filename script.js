
// ==========================================
// ORBIT — Spotify Integration
// ==========================================

// SPOTIFY CONFIGURATION
const CLIENT_ID = "6951277cd85c47699869b8b8cfbff243";

const REDIRECT_URI =
  "https://anirudhsrn-source.github.io/ORBIT/";

const SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state"
].join(" ");

// ==========================================
// ELEMENTS
// ==========================================

const loginButton = document.getElementById("loginButton");
const playButton = document.getElementById("play");
const nextButton = document.getElementById("next");
const previousButton = document.getElementById("previous");
const dial = document.getElementById("dial");

const trackName = document.getElementById("trackName");
const artistName = document.getElementById("artistName");

let accessToken = sessionStorage.getItem("orbit_token");
let refreshToken = sessionStorage.getItem("orbit_refresh");
let tokenExpiry = Number(sessionStorage.getItem("orbit_expiry") || 0);

let dialRotation = 0;
let isPlaying = false;

// ==========================================
// PKCE HELPERS
// ==========================================

function randomString(length) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  const values = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(values)
    .map(value => characters[value % characters.length])
    .join("");
}

async function createChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);

  const digest = await crypto.subtle.digest("SHA-256", data);

  return btoa(
    String.fromCharCode(...new Uint8Array(digest))
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ==========================================
// SPOTIFY LOGIN
// ==========================================

async function login() {
  try {
    const verifier = randomString(64);
    const challenge = await createChallenge(verifier);
    const state = randomString(32);

    sessionStorage.setItem("orbit_verifier", verifier);
    sessionStorage.setItem("orbit_state", state);

    const parameters = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state: state,
      code_challenge_method: "S256",
      code_challenge: challenge
    });

    window.location.assign(
      "https://accounts.spotify.com/authorize?" +
      parameters.toString()
    );

  } catch (error) {
    console.error("Login error:", error);
    alert("ORBIT login error: " + error.message);
  }
}

// ==========================================
// TOKEN STORAGE
// ==========================================

function saveTokens(data) {
  accessToken = data.access_token;

  sessionStorage.setItem("orbit_token", accessToken);

  tokenExpiry = Date.now() + data.expires_in * 1000;

  sessionStorage.setItem(
    "orbit_expiry",
    String(tokenExpiry)
  );

  if (data.refresh_token) {
    refreshToken = data.refresh_token;

    sessionStorage.setItem(
      "orbit_refresh",
      refreshToken
    );
  }
}

function clearTokens() {
  accessToken = null;
  refreshToken = null;
  tokenExpiry = 0;

  sessionStorage.removeItem("orbit_token");
  sessionStorage.removeItem("orbit_refresh");
  sessionStorage.removeItem("orbit_expiry");

  loginButton.textContent = "CONNECT SPOTIFY";
}

// ==========================================
// TOKEN EXCHANGE
// ==========================================

async function exchangeCode(code) {
  const verifier = sessionStorage.getItem("orbit_verifier");
  const savedState = sessionStorage.getItem("orbit_state");

  const params = new URLSearchParams(window.location.search);
  const returnedState = params.get("state");

  if (
    !verifier ||
    !savedState ||
    returnedState !== savedState
  ) {
    throw new Error(
      "Login verification failed. Please connect again."
    );
  }

  const response = await fetch(
    "https://accounts.spotify.com/api/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error_description ||
      data.error ||
      "Spotify token exchange failed."
    );
  }

  saveTokens(data);

  sessionStorage.removeItem("orbit_verifier");
  sessionStorage.removeItem("orbit_state");

  window.history.replaceState(
    {},
    document.title,
    REDIRECT_URI
  );

  await finishLogin();
}

// ==========================================
// AUTOMATIC TOKEN REFRESH
// ==========================================

async function refreshAccessToken() {
  if (!refreshToken) {
    clearTokens();
    return false;
  }

  try {
    const response = await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Token refresh error:", data);
      clearTokens();
      return false;
    }

    saveTokens(data);
    return true;

  } catch (error) {
    console.error("Refresh error:", error);
    return false;
  }
}

async function ensureValidToken() {
  if (!accessToken) return false;

  if (Date.now() < tokenExpiry - 60000) {
    return true;
  }

  return await refreshAccessToken();
}

// ==========================================
// SPOTIFY API REQUEST
// ==========================================

async function spotifyRequest(
  endpoint,
  method = "GET"
) {
  const valid = await ensureValidToken();

  if (!valid) {
    return null;
  }

  try {
    const response = await fetch(
      "https://api.spotify.com/v1" + endpoint,
      {
        method: method,
        headers: {
          Authorization: "Bearer " + accessToken
        }
      }
    );

    if (response.status === 204) {
      return null;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.error_description ||
        "Unknown Spotify error";

      console.error("Spotify API error:", {
        endpoint,
        status: response.status,
        message,
        details: data
      });

      if (response.status === 401) {
        clearTokens();
      } else {
        alert(
          "Spotify API Error\n\n" +
          "Status: " + response.status + "\n" +
          "Endpoint: " + endpoint + "\n" +
          "Message: " + message
        );
      }

      return null;
    }

    return data;

  } catch (error) {
    console.error("Network error:", error);

    alert(
      "Could not reach Spotify.\n" +
      error.message
    );

    return null;
  }
}

// ==========================================
// LOAD SPOTIFY PROFILE
// ==========================================

async function loadProfile() {
  const profile = await spotifyRequest("/me");

  if (!profile) {
    return false;
  }

  loginButton.textContent =
    "CONNECTED: " +
    (profile.display_name || "SPOTIFY");

  trackName.textContent = "Spotify connected";
  artistName.textContent = "Welcome to ORBIT";

  return true;
}

// ==========================================
// CURRENTLY PLAYING
// ==========================================

async function updatePlayback() {
  const playback = await spotifyRequest(
    "/me/player/currently-playing"
  );

  if (!playback || !playback.item) {
    return;
  }

  trackName.textContent = playback.item.name;

  artistName.textContent =
    playback.item.artists
      .map(artist => artist.name)
      .join(", ");

  isPlaying = playback.is_playing;

  playButton.textContent = isPlaying ? "Ⅱ" : "▶";
}

// ==========================================
// PLAYBACK CONTROLS
// ==========================================

async function togglePlayback() {
  const playback = await spotifyRequest("/me/player");

  if (!playback) {
    alert(
      "No active Spotify playback found. " +
      "Start playing music on a Spotify device first."
    );
    return;
  }

  if (playback.is_playing) {
    await spotifyRequest("/me/player/pause", "PUT");
    isPlaying = false;
  } else {
    await spotifyRequest("/me/player/play", "PUT");
    isPlaying = true;
  }

  playButton.textContent = isPlaying ? "Ⅱ" : "▶";

  setTimeout(updatePlayback, 1000);
}

async function nextTrack() {
  await spotifyRequest("/me/player/next", "POST");

  setTimeout(updatePlayback, 1200);
}

async function previousTrack() {
  await spotifyRequest("/me/player/previous", "POST");

  setTimeout(updatePlayback, 1200);
}

// ==========================================
// ROTARY DIAL
// ==========================================

dial.addEventListener("click", async () => {
  dialRotation += 45;

  dial.style.transform =
    `rotate(${dialRotation}deg)`;

  if (!accessToken) {
    trackName.textContent = "Connect Spotify first";
    return;
  }

  await nextTrack();
});

// ==========================================
// BUTTON EVENTS
// ==========================================

loginButton.addEventListener("click", login);

playButton.addEventListener("click", togglePlayback);

nextButton.addEventListener("click", nextTrack);

previousButton.addEventListener("click", previousTrack);

// ==========================================
// COMPLETE LOGIN
// ==========================================

async function finishLogin() {
  loginButton.textContent = "CONNECTING...";

  const connected = await loadProfile();

  if (connected) {
    await updatePlayback();
  } else {
    loginButton.textContent = "RETRY CONNECTION";
  }
}

// ==========================================
// START ORBIT
// ==========================================

async function startORBIT() {
  try {
    const params = new URLSearchParams(
      window.location.search
    );

    const code = params.get("code");
    const error = params.get("error");

    if (error) {
      window.history.replaceState(
        {},
        document.title,
        REDIRECT_URI
      );

      throw new Error(
        "Spotify authorization: " + error
      );
    }

    if (code) {
      await exchangeCode(code);
      return;
    }

    if (accessToken) {
      const valid = await ensureValidToken();

      if (valid) {
        await finishLogin();
      }
    }

  } catch (error) {
    console.error("ORBIT startup error:", error);

    loginButton.textContent = "CONNECT SPOTIFY";

    alert(
      "ORBIT startup error:\n" + error.message
    );
  }
}

startORBIT();
