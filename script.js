
// ORBIT — Spotify connection and controls

// 1. ADD YOUR SPOTIFY CLIENT ID HERE LATER
const CLIENT_ID = "6951277cd85c47699869b8b8cfbff243";

// 2. Automatically use this site's address as the Spotify redirect
const REDIRECT_URI = window.location.origin + window.location.pathname;

const SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-modify-playback-state"
].join(" ");

const loginButton = document.getElementById("loginButton");
const playButton = document.getElementById("play");
const nextButton = document.getElementById("next");
const previousButton = document.getElementById("previous");
const dial = document.getElementById("dial");

let accessToken = sessionStorage.getItem("orbit_token");
let dialRotation = 0;

// Generate a secure random string for Spotify PKCE
function randomString(length) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  const values = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(values)
    .map(value => characters[value % characters.length])
    .join("");
}

// Create the SHA-256 challenge
async function createChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// Start Spotify login
async function login() {
  if (CLIENT_ID === "PASTE_YOUR_SPOTIFY_CLIENT_ID_HERE") {
    alert("First add your Spotify Client ID to script.js.");
    return;
  }

  const verifier = randomString(64);
  const challenge = await createChallenge(verifier);
  const state = randomString(16);

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

  window.location.href =
    "https://accounts.spotify.com/authorize?" + parameters.toString();
}

// Exchange the authorization code for an access token
async function exchangeCode(code) {
  const verifier = sessionStorage.getItem("orbit_verifier");
  const returnedState = new URLSearchParams(window.location.search).get("state");
  const savedState = sessionStorage.getItem("orbit_state");

  if (!verifier || !savedState || returnedState !== savedState) {
    alert("Spotify login verification failed. Please try again.");
    return;
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
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
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(data);
    alert("Spotify login failed. Check your app settings and redirect URI.");
    return;
  }

  accessToken = data.access_token;
  sessionStorage.setItem("orbit_token", accessToken);
  sessionStorage.setItem("orbit_expiry", Date.now() + data.expires_in * 1000);

  sessionStorage.removeItem("orbit_verifier");
  sessionStorage.removeItem("orbit_state");

  // Remove the temporary code from the address bar
  window.history.replaceState({}, document.title, REDIRECT_URI);

  await loadProfile();
  await updatePlayback();
}

// Make an authenticated Spotify API request
async function spotifyRequest(endpoint, method = "GET") {
  if (!accessToken) {
    alert("Connect Spotify first.");
    return null;
  }

  const response = await fetch("https://api.spotify.com/v1" + endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + accessToken
    }
  });

  if (response.status === 204) return null;

  if (response.status === 401) {
    sessionStorage.removeItem("orbit_token");
    accessToken = null;
    alert("Your Spotify session expired. Please connect again.");
    return null;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error("Spotify API error:", error);
    return null;
  }

  return response.json();
}

// Load Spotify profile
async function loadProfile() {
  const profile = await spotifyRequest("/me");

  if (!profile) return;

  loginButton.textContent = "CONNECTED: " + profile.display_name;
}

// Show the currently playing track
async function updatePlayback() {
  const playback = await spotifyRequest("/me/player/currently-playing");

  if (!playback || !playback.item) return;

  document.getElementById("trackName").textContent =
    playback.item.name;

  document.getElementById("artistName").textContent =
    playback.item.artists.map(artist => artist.name).join(", ");
}

// Playback controls
async function togglePlayback() {
  const playback = await spotifyRequest("/me/player");

  if (!playback) {
    alert("Start Spotify on one of your devices first.");
    return;
  }

  if (playback.is_playing) {
    await spotifyRequest("/me/player/pause", "PUT");
    playButton.textContent = "▶";
  } else {
    await spotifyRequest("/me/player/play", "PUT");
    playButton.textContent = "Ⅱ";
  }

  setTimeout(updatePlayback, 800);
}

async function nextTrack() {
  await spotifyRequest("/me/player/next", "POST");
  setTimeout(updatePlayback, 1000);
}

async function previousTrack() {
  await spotifyRequest("/me/player/previous", "POST");
  setTimeout(updatePlayback, 1000);
}

// Rotary dial interaction
dial.addEventListener("click", () => {
  dialRotation += 45;
  dial.style.transform = `rotate(${dialRotation}deg)`;

  if (accessToken) {
    nextTrack();
  } else {
    document.getElementById("trackName").textContent =
      "Connect Spotify first";
  }
});

// Button interactions
loginButton.addEventListener("click", login);
playButton.addEventListener("click", togglePlayback);
nextButton.addEventListener("click", nextTrack);
previousButton.addEventListener("click", previousTrack);

// Handle Spotify's return redirect
async function startORBIT() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const error = params.get("error");

  if (error) {
    alert("Spotify connection was cancelled.");
    window.history.replaceState({}, document.title, REDIRECT_URI);
    return;
  }

  if (code) {
    await exchangeCode(code);
  } else if (accessToken) {
    const expiry = Number(sessionStorage.getItem("orbit_expiry") || 0);

    if (Date.now() < expiry) {
      await loadProfile();
      await updatePlayback();
    } else {
      sessionStorage.removeItem("orbit_token");
      accessToken = null;
      loginButton.textContent = "CONNECT SPOTIFY";
    }
  }
}

startORBIT();
