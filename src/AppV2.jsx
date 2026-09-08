import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import "./v2-app.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const TABS = {
  HOME: "home",
  RECORD: "record",
  LEADERBOARD: "leaderboard",
  CALENDAR: "calendar",
  PLAYERS: "players",
  GALLERY: "gallery",
};

const FORMATIONS = {
  "4-3-3": ["GK", "LB", "CB", "CB", "RB", "CM", "CM", "CAM", "LW", "ST", "RW"],
  "4-4-2": ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"],
  "4-2-3-1": ["GK", "LB", "CB", "CB", "RB", "CDM", "CDM", "LW", "CAM", "RW", "ST"],
  "3-5-2": ["GK", "CB", "CB", "CB", "LM", "CM", "CAM", "CM", "RM", "ST", "ST"],
};

const POSITION_OPTIONS = ["GK", "LB", "CB", "RB", "LWB", "RWB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "ST", "CF"];
const CATEGORY_OPTIONS = ["all", "attacker", "midfielder", "defender", "goalkeeper"];

function idOf(value) {
  return String(value?._id || value || "");
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return date.toISOString().slice(0, 10);
}

async function api(path, options = {}) {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  const headers = {
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

function initials(name = "Player") {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export default function AppV2() {
  const [activeTab, setActiveTab] = useState(TABS.HOME);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [backendUser, setBackendUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [news, setNews] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerDetail, setPlayerDetail] = useState(null);
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);
  const [aiReview, setAiReview] = useState("");
  const [aiReviewLoading, setAiReviewLoading] = useState(false);

  const [formation, setFormation] = useState("4-3-3");
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardFilter, setLeaderboardFilter] = useState("all");
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [awardModal, setAwardModal] = useState(false);
  const [awardHistory, setAwardHistory] = useState([]);
  const [awardYear, setAwardYear] = useState(new Date().getFullYear());

  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1);
  const [calendarMatches, setCalendarMatches] = useState([]);
  const [calendarMatch, setCalendarMatch] = useState(null);
  const [calendarMatchDetail, setCalendarMatchDetail] = useState(null);
  const [votedMatches, setVotedMatches] = useState({});

  const [galleryMatchId, setGalleryMatchId] = useState("");
  const [galleryPlayerId, setGalleryPlayerId] = useState("");
  const [galleryFile, setGalleryFile] = useState(null);
  const [galleryCaption, setGalleryCaption] = useState("");
  const [gallerySaving, setGallerySaving] = useState(false);
  const [galleryLikes, setGalleryLikes] = useState({});

  const [matchName, setMatchName] = useState("");
  const [matchDate, setMatchDate] = useState(formatDateInput(new Date()));
  const [teamALabel, setTeamALabel] = useState("Side 1");
  const [teamBLabel, setTeamBLabel] = useState("Side 2");
  const [recordRows, setRecordRows] = useState({});
  const [savingMatch, setSavingMatch] = useState(false);

  const [clasico, setClasico] = useState(null);
  const [clasicoCommentary, setClasicoCommentary] = useState("");
  const [clasicoLoading, setClasicoLoading] = useState(false);

  const [preferenceData, setPreferenceData] = useState(null);
  const [preferredPositions, setPreferredPositions] = useState([]);
  const [clasicoSide, setClasicoSide] = useState("");
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [preferenceRequests, setPreferenceRequests] = useState([]);

  const isSignedIn = Boolean(firebaseUser);
  const isAdmin = backendUser?.role === "admin";
  const isEditor = isAdmin || backendUser?.role === "editor";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthLoading(true);
      if (!user) {
        setBackendUser(null);
        setAuthLoading(false);
        return;
      }
      try {
        const data = await api("/auth/me");
        setBackendUser(data.user || null);
      } catch (error) {
        setMessage(error.message);
        setBackendUser(null);
      } finally {
        setAuthLoading(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [playerData, matchData, newsData, galleryData] = await Promise.all([
          api("/players"),
          api("/matches"),
          api("/news?limit=20"),
          api("/gallery"),
        ]);
        if (!alive) return;
        setPlayers(Array.isArray(playerData) ? playerData : playerData.players || []);
        setMatches(Array.isArray(matchData) ? matchData : matchData.matches || []);
        setNews(Array.isArray(newsData) ? newsData : newsData.news || []);
        setGallery(Array.isArray(galleryData) ? galleryData : galleryData.photos || []);
      } catch (error) {
        if (alive) setMessage(error.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (activeTab === TABS.LEADERBOARD) loadLeaderboard();
    if (activeTab === TABS.CALENDAR) loadCalendar();
    if (activeTab === TABS.RECORD) prepareRecordRows();
    if (activeTab === TABS.PLAYERS) loadSquad();
    if (activeTab === TABS.RECORD) loadClasico();
    if (isSignedIn) loadPreferences();
  }, [activeTab, leaderboardFilter, calendarYear, calendarMonth, isSignedIn]);

  async function loadSquad() {
    try {
      const data = await api("/v2/squad");
      const enriched = data.players || [];
      setPlayers((current) => current.map((player) => enriched.find((item) => idOf(item) === idOf(player)) || player));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadLeaderboard() {
    try {
      setLeaderboardLoading(true);
      const category = leaderboardFilter === "all" ? "" : `&category=${leaderboardFilter}`;
      const data = await api(`/v2/leaderboard?${category.replace(/^&/, "")}`.replace(/\?$/, ""));
      setLeaderboard(data.leaderboard || []);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLeaderboardLoading(false);
    }
  }

  async function loadAwards(year = awardYear) {
    try {
      const [current, history] = await Promise.all([
        api(`/v2/awards?year=${year}`),
        api("/v2/awards/history"),
      ]);
      setAwardHistory(history || []);
      return current;
    } catch (error) {
      setMessage(error.message);
      return null;
    }
  }

  async function loadCalendar() {
    try {
      const data = await api(`/stats/calendar?year=${calendarYear}&month=${calendarMonth}`);
      setCalendarMatches(data.matches || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function openMatch(match) {
    setCalendarMatch(match);
    try {
      const detail = await api(`/v2/matches/${idOf(match)}`);
      setCalendarMatchDetail(detail);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadClasico() {
    try {
      setClasico(await api("/v2/el-clasico"));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function generateClasicoCommentary() {
    if (!clasico || !isSignedIn) return;
    try {
      setClasicoLoading(true);
      const data = await api("/v2/el-clasico/commentary", {
        method: "POST",
        body: JSON.stringify({ data: { Messi: clasico.sides.Messi, Ronaldo: clasico.sides.Ronaldo } }),
      });
      setClasicoCommentary(data.commentary || "");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setClasicoLoading(false);
    }
  }

  async function loadPreferences() {
    try {
      const data = await api("/v2/preferences/me");
      setPreferenceData(data);
      setPreferredPositions(data.meta?.preferredPositions || []);
      setClasicoSide(data.meta?.elClasicoSide || "");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function submitPreferences() {
    if (!preferenceData?.linkedPlayer) {
      setMessage("Your account is not linked to a player profile yet.");
      return;
    }
    try {
      setPreferenceSaving(true);
      await api("/v2/preferences/me", {
        method: "POST",
        body: JSON.stringify({ preferredPositions, elClasicoSide: clasicoSide }),
      });
      setMessage("Position and El Clásico preferences sent for admin approval.");
      await loadPreferences();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setPreferenceSaving(false);
    }
  }

  async function loadAdminPreferenceRequests() {
    if (!isAdmin) return;
    try {
      setPreferenceRequests(await api("/v2/preferences/admin"));
    } catch (error) {
      setMessage(error.message);
    }
  }

  useEffect(() => {
    if (isAdmin && activeTab === TABS.PLAYERS) loadAdminPreferenceRequests();
  }, [isAdmin, activeTab]);

  async function reviewPreference(id, action) {
    try {
      await api(`/v2/preferences/admin/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
      await loadAdminPreferenceRequests();
      await loadSquad();
      setMessage(`Preference request ${action}ed.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function openPlayer(player) {
    setSelectedPlayer(player);
    setPlayerDetail(null);
    setAiReview("");
    setPlayerDetailLoading(true);
    try {
      setPlayerDetail(await api(`/v2/player/${idOf(player)}`));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setPlayerDetailLoading(false);
    }
  }

  async function generatePlayerReview() {
    if (!selectedPlayer) return;
    try {
      setAiReviewLoading(true);
      const data = await api(`/news/player/${idOf(selectedPlayer)}`, { method: "POST" });
      setAiReview(data.body || data.review || data.summary || "");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setAiReviewLoading(false);
    }
  }

  const squadPlayers = useMemo(() => players.map((player) => {
    const positions = player.preferredPositions?.length ? player.preferredPositions : [player.position].filter(Boolean);
    return { ...player, positions };
  }), [players]);

  const startingXI = useMemo(() => {
    const used = new Set();
    const sorted = [...squadPlayers].sort((a, b) => number(b.stats?.ggRating, -1) - number(a.stats?.ggRating, -1) || number(b.stats?.matches) - number(a.stats?.matches));
    return FORMATIONS[formation].map((slot) => {
      const player = sorted.find((p) => !used.has(idOf(p)) && p.positions.includes(slot));
      if (player) used.add(idOf(player));
      return { slot, player: player || null };
    });
  }, [squadPlayers, formation]);

  const bench = useMemo(() => squadPlayers.filter((p) => !startingXI.some((x) => x.player && idOf(x.player) === idOf(p))), [squadPlayers, startingXI]);

  function prepareRecordRows() {
    setRecordRows((current) => {
      const next = { ...current };
      players.forEach((player) => {
        const key = idOf(player);
        if (!next[key]) next[key] = { team: "", goals: 0, assists: 0, rating: "" };
      });
      return next;
    });
  }

  function updateRecordRow(playerId, patch) {
    setRecordRows((current) => ({ ...current, [playerId]: { ...(current[playerId] || {}), ...patch } }));
  }

  const assigned = useMemo(() => players.filter((p) => ["A", "B"].includes(recordRows[idOf(p)]?.team)), [players, recordRows]);
  const teamAPlayers = assigned.filter((p) => recordRows[idOf(p)]?.team === "A");
  const teamBPlayers = assigned.filter((p) => recordRows[idOf(p)]?.team === "B");
  const teamAScore = teamAPlayers.reduce((sum, p) => sum + number(recordRows[idOf(p)]?.goals), 0);
  const teamBScore = teamBPlayers.reduce((sum, p) => sum + number(recordRows[idOf(p)]?.goals), 0);

  async function saveMatch(event) {
    event.preventDefault();
    if (!isEditor) return setMessage("Editor access required.");
    if (!teamAPlayers.length || !teamBPlayers.length) return setMessage("Both sides need at least one player.");
    const missingRating = assigned.find((p) => {
      const value = recordRows[idOf(p)]?.rating;
      return value === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 10;
    });
    if (missingRating) return setMessage(`Enter a 0–10 rating for ${missingRating.name}.`);

    const totalAssists = assigned.reduce((sum, p) => sum + number(recordRows[idOf(p)]?.assists), 0);
    if (totalAssists > teamAScore + teamBScore) return setMessage("Assists cannot be greater than total goals.");

    const events = [];
    for (const player of assigned) {
      const row = recordRows[idOf(player)];
      for (let i = 0; i < number(row.goals); i += 1) events.push({ player: player._id, type: "goal" });
      for (let i = 0; i < number(row.assists); i += 1) events.push({ player: player._id, type: "assist" });
    }

    try {
      setSavingMatch(true);
      const created = await api("/matches", {
        method: "POST",
        body: JSON.stringify({
          date: matchDate,
          name: matchName.trim() || "Football Match",
          teamA: { label: teamALabel.trim() || "Side 1", score: teamAScore },
          teamB: { label: teamBLabel.trim() || "Side 2", score: teamBScore },
          participants: assigned.map((p) => ({ player: p._id, team: recordRows[idOf(p)].team })),
          events,
        }),
      });
      const matchId = created.match?._id || created._id;
      await api(`/v2/matches/${matchId}/ratings`, {
        method: "POST",
        body: JSON.stringify({ ratings: assigned.map((p) => ({ player: p._id, rating: Number(recordRows[idOf(p)].rating) })) }),
      });
      setMatches((current) => [created.match || created, ...current]);
      await loadLeaderboard();
      await loadClasico();
      setMessage("Match recorded with player ratings.");
      setMatchName("");
      setRecordRows({});
      prepareRecordRows();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingMatch(false);
    }
  }

  async function like(targetType, targetId) {
    if (!isSignedIn) return setMessage("Sign in to like this.");
    try {
      const key = `${targetType}:${targetId}`;
      if (galleryLikes[key]?.likedByMe) return;
      const data = await api(`/v2/likes/${targetType}/${targetId}`, { method: "POST", body: JSON.stringify({}) });
      setGalleryLikes((current) => ({ ...current, [key]: data }));
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function uploadPhoto() {
    if (!isSignedIn) return setMessage("Sign in to upload a photo.");
    if (!galleryFile) return setMessage("Choose a photo first.");
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) return setMessage("Cloudinary upload settings are missing.");
    try {
      setGallerySaving(true);
      const formData = new FormData();
      formData.append("file", galleryFile);
      formData.append("upload_preset", uploadPreset);
      const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: formData });
      const uploadData = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(uploadData.error?.message || "Image upload failed.");
      await api("/gallery", { method: "POST", body: JSON.stringify({ imageUrl: uploadData.secure_url, caption: galleryCaption, matchId: galleryMatchId || null, playerId: galleryPlayerId || null }) });
      setGalleryFile(null);
      setGalleryCaption("");
      setGalleryMatchId("");
      setGalleryPlayerId("");
      await refreshGallery();
      setMessage("Photo added to GG Gallery.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setGallerySaving(false);
    }
  }

  async function refreshGallery() {
    try {
      const data = await api("/gallery");
      setGallery(Array.isArray(data) ? data : data.photos || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function vote(matchId, playerId) {
    if (!isSignedIn) return setMessage("Sign in to vote for POTM.");
    if (votedMatches[matchId]) return;
    try {
      await api(`/v2/matches/${matchId}/potm`, { method: "POST", body: JSON.stringify({ playerId }) });
      setVotedMatches((current) => ({ ...current, [matchId]: playerId }));
      const detail = await api(`/v2/matches/${matchId}`);
      setCalendarMatchDetail(detail);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function signIn() {
    try {
      if (window.innerWidth < 700) await signInWithRedirect(auth, googleProvider);
      else await signInWithPopup(auth, googleProvider);
    } catch (error) {
      setMessage(error.message || "Google sign-in failed.");
    }
  }

  async function logout() {
    await signOut(auth);
    setBackendUser(null);
    setActiveTab(TABS.HOME);
  }

  function calendarDays(year, month) {
    const first = new Date(year, month - 1, 1).getDay();
    const total = new Date(year, month, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  }

  const latestMatch = matches[0] || null;
  const totalGoals = matches.reduce((sum, match) => sum + number(match.teamA?.score) + number(match.teamB?.score), 0);

  return (
    <main className="app v2-app">
      <header className="topbar">
        <div><p className="eyebrow">GG MATCHDAY</p><h1>Football Stats</h1></div>
        <div className="status-dot"><span />LIVE</div>
      </header>

      <section className="account-bar">
        {authLoading ? <span className="account-status">Checking account...</span> : firebaseUser ? (
          <>
            <div className="account-user">
              {firebaseUser.photoURL ? <img src={firebaseUser.photoURL} alt="" /> : <span>{initials(firebaseUser.displayName || firebaseUser.email)}</span>}
              <div><strong>{firebaseUser.displayName || "GG Matchday User"}</strong><small>{backendUser?.role || "viewer"}</small></div>
            </div>
            <div className="account-actions">
              <button className="secondary-button" type="button" onClick={logout}>Sign Out</button>
            </div>
          </>
        ) : (
          <div className="signed-out-account"><div><strong>Viewer mode</strong><small>Public read-only access</small></div><button className="google-button" type="button" onClick={signIn}>Continue with Google</button></div>
        )}
      </section>

      {message && <div className="global-message"><span>{message}</span><button type="button" onClick={() => setMessage("")}>×</button></div>}

      {activeTab === TABS.HOME && (
        <section className="tab-content home-page">
          <section className="home-hero"><p className="eyebrow">YOUR FOOTBALL JOURNAL</p><h2>Welcome to GG Matchday.</h2><p className="home-intro">Matches, players, rankings, photos and every part of your football story in one place.</p></section>
          <section className="home-feature-card"><div className="feature-label">⚡ MATCHDAY MOMENT</div><h2>{latestMatch ? `${latestMatch.name || "Football Match"} — ${latestMatch.teamA?.label} ${latestMatch.teamA?.score} : ${latestMatch.teamB?.score} ${latestMatch.teamB?.label}` : "Your football story starts here."}</h2><p>{latestMatch ? `Played ${formatDate(latestMatch.date)}.` : "Record your first match and the Matchday story will appear here."}</p></section>
          <section className="home-stat-grid"><HomeStat label="PLAYERS" value={players.length} /><HomeStat label="MATCHES" value={matches.length} /><HomeStat label="GOALS" value={totalGoals} /><HomeStat label="PHOTOS" value={gallery.length} /></section>
          <section className="home-section"><SectionHeading eyebrow="GG RANKINGS" title="Current Top 3" action="Leaderboard" onAction={() => setActiveTab(TABS.LEADERBOARD)} />
            <div className="home-top3">{(leaderboard.length ? leaderboard : players.map((p) => ({ playerId: p._id, name: p.name, ggRating: null })).slice(0, 3)).slice(0, 3).map((player, index) => <button key={player.playerId || index} className="home-top-card" type="button" onClick={() => { const p = players.find((x) => idOf(x) === idOf(player.playerId)); if (p) { setActiveTab(TABS.PLAYERS); openPlayer(p); } }}><b>{index + 1}</b><span>{player.name}</span><strong>{player.ggRating != null ? `${player.ggRating} ★` : "—"}</strong></button>)}</div>
          </section>
          <section className="home-section"><SectionHeading eyebrow="THE GG DESK" title="Latest News" action="Gallery" onAction={() => setActiveTab(TABS.GALLERY)} />{news.length ? <div className="news-list">{news.slice(0, 4).map((item) => <article className="news-card" key={item._id}><div className="news-icon">{item.icon || "⚽"}</div><div className="news-content"><span className="news-type">THE GG DESK</span><h3>{item.headline}</h3><p>{item.summary}</p><small>{formatDate(item.createdAt)}</small><div className="v2-like-row"><span>♥ {galleryLikes[`news:${item._id}`]?.count ?? 0}</span><button type="button" onClick={() => like("news", item._id)}>Like</button></div></div></article>)}</div> : <div className="empty-state"><span>📰</span><h3>No stories yet</h3><p>Match reports will appear here as the archive grows.</p></div>}</section>
        </section>
      )}

      {activeTab === TABS.RECORD && (
        <section className="tab-content">
          {!isEditor ? <AccessDenied title="Editor access required" description="Only approved editors can record or modify GG Matchday data." signIn={!isSignedIn ? signIn : null} /> : (
            <>
              <div className="page-title"><p className="eyebrow">MATCH DAY</p><h2>Record a Match</h2><p>Assign each player to a side, then enter goals, assists and one 0–10 match rating in the same row.</p></div>
              <section className="card">
                <form onSubmit={saveMatch}>
                  <div className="form-grid"><label><span>Date</span><input type="date" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} /></label><label><span>Match Name</span><input value={matchName} onChange={(e) => setMatchName(e.target.value)} placeholder="Sunday Football" /></label></div>
                  <div className="match-score-header"><div className="side-block"><span>Side 1</span><input value={teamALabel} onChange={(e) => setTeamALabel(e.target.value)} /><strong>{teamAScore}</strong></div><div className="versus">:</div><div className="side-block"><span>Side 2</span><input value={teamBLabel} onChange={(e) => setTeamBLabel(e.target.value)} /><strong>{teamBScore}</strong></div></div>
                  <div className="v2-record-table">
                    <div className="v2-record-head"><span>PLAYER</span><span>SIDE</span><span>GOALS</span><span>ASSISTS</span><span>RATING</span></div>
                    {players.map((player) => {
                      const row = recordRows[idOf(player)] || { team: "", goals: 0, assists: 0, rating: "" };
                      const inactive = !row.team;
                      return <div className={`v2-record-row ${inactive ? "inactive" : ""}`} key={idOf(player)}>
                        <div className="v2-record-player"><strong>{player.name}</strong><small>{row.team === "A" ? teamALabel : row.team === "B" ? teamBLabel : "Not participating"}</small></div>
                        <div className="v2-side-buttons"><button type="button" className={row.team === "A" ? "active" : ""} onClick={() => updateRecordRow(idOf(player), { team: row.team === "A" ? "" : "A" })}>1</button><button type="button" className={row.team === "B" ? "active" : ""} onClick={() => updateRecordRow(idOf(player), { team: row.team === "B" ? "" : "B" })}>2</button></div>
                        <Counter value={row.goals} disabled={inactive} onChange={(value) => updateRecordRow(idOf(player), { goals: value })} />
                        <Counter value={row.assists} disabled={inactive} onChange={(value) => updateRecordRow(idOf(player), { assists: value })} />
                        <input className="v2-rating-input" type="number" min="0" max="10" step="0.1" disabled={inactive} value={row.rating} placeholder="0–10" onChange={(e) => updateRecordRow(idOf(player), { rating: e.target.value })} />
                      </div>;
                    })}
                  </div>
                  <button className="save-button" type="submit" disabled={savingMatch}>{savingMatch ? "Saving..." : "Save Match"}</button>
                </form>
              </section>

              <section className="v2-secondary-page card"><div className="v2-section-title"><div><p className="eyebrow">RIVALRY</p><h3>El Clásico</h3></div><span>Only matches named El Clásico appear here.</span></div><div className="clasico-grid"><ClasicoSide title="MESSI FANS" side={clasico?.sides?.Messi} /><ClasicoSide title="RONALDO FANS" side={clasico?.sides?.Ronaldo} /></div><div className="v2-ai-block"><div><p className="eyebrow">GG MATCHDAY COMMENTARY</p><h3>Rivalry Report</h3></div><button type="button" className="secondary-button" disabled={!isSignedIn || clasicoLoading} onClick={generateClasicoCommentary}>{clasicoLoading ? "Generating..." : "Generate Commentary"}</button>{clasicoCommentary && <p>{clasicoCommentary}</p>}</div><div className="v2-match-history">{clasico?.matches?.map((match) => <button type="button" key={match._id} onClick={() => openMatch(match)}><span>{formatDate(match.date)}</span><strong>{match.teamA?.label} {match.teamA?.score} : {match.teamB?.score} {match.teamB?.label}</strong></button>)}</div></section>
            </>
          )}
        </section>
      )}

      {activeTab === TABS.LEADERBOARD && (
        <section className="tab-content"><div className="page-title"><p className="eyebrow">GG RANKINGS</p><h2>Leaderboard</h2><p>Professional 0–10 GG Rating with position and season filters.</p></div><div className="filter-row">{CATEGORY_OPTIONS.map((item) => <button key={item} type="button" className={leaderboardFilter === item ? "active" : ""} onClick={() => setLeaderboardFilter(item)}>{item === "all" ? "Overall" : item[0].toUpperCase() + item.slice(1)}</button>)}</div>{leaderboardLoading ? <div className="loading-panel">Calculating rankings...</div> : <><section className="card"><div className="v2-top3-row">{leaderboard.filter((p) => p.ggRating !== null).slice(0, 3).map((p, index) => <button key={p.playerId} type="button" onClick={() => { const player = players.find((x) => idOf(x) === idOf(p.playerId)); if (player) openPlayer(player); }}><b>{["🥇","🥈","🥉"][index]}</b><strong>{p.name}</strong><span>{p.ggRating} ★</span></button>)}</div><div className="v2-table"><div className="v2-table-head"><span>#</span><span>Player</span><span>Pos</span><span>MP</span><span>W</span><span>L</span><span>G</span><span>A</span><span>CS</span><span>Rating</span></div>{leaderboard.map((p) => <button className="v2-table-row" type="button" key={p.playerId} onClick={() => { const player = players.find((x) => idOf(x) === idOf(p.playerId)); if (player) openPlayer(player); }}><span>{p.rank}</span><strong>{p.name}</strong><span>{p.position || "—"}</span><span>{p.matches}</span><span>{p.wins}</span><span>{p.losses}</span><span>{p.goals}</span><span>{p.assists}</span><span>{p.cleanSheets}</span><b>{p.ggRating == null ? "—" : `${p.ggRating} ★`}</b></button>)}</div></section><section className="award-showcase card"><div className="v2-section-title"><div><p className="eyebrow">SHOWCASE</p><h3>Awards</h3></div><button type="button" className="secondary-button" onClick={async () => { await loadAwards(); setAwardModal(true); }}>Open Awards</button></div></section></>}</section>
      )}

      {activeTab === TABS.CALENDAR && (
        <section className="tab-content"><div className="page-title"><p className="eyebrow">MATCH JOURNAL</p><h2>Calendar</h2><p>Select a day to open a specific match and vote for its Player of the Match.</p></div><section className="card"><div className="calendar-header"><button type="button" className="calendar-nav" onClick={() => setCalendarMonth((m) => m === 1 ? 12 : m - 1)}>‹</button><div><h3>{new Date(calendarYear, calendarMonth - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" })}</h3><span>{calendarMatches.length} matches</span></div><button type="button" className="calendar-nav" onClick={() => setCalendarMonth((m) => m === 12 ? 1 : m + 1)}>›</button></div><div className="calendar-weekdays">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((x) => <span key={x}>{x}</span>)}</div><div className="calendar-grid">{calendarDays(calendarYear, calendarMonth).map((day, index) => { const dayMatches = calendarMatches.filter((m) => { const d = new Date(m.date); return d.getFullYear() === calendarYear && d.getMonth() + 1 === calendarMonth && d.getDate() === day; }); return <button key={index} className={`calendar-day ${dayMatches.length ? "has-match" : ""}`} type="button" disabled={!day} onClick={() => dayMatches[0] && openMatch(dayMatches[0])}>{day && <><strong>{day}</strong>{dayMatches.length > 0 && <span className="calendar-dot" />}</>}</button>; })}</div></section></section>
      )}

      {activeTab === TABS.PLAYERS && (
        <section className="tab-content"><div className="page-title"><p className="eyebrow">SQUAD</p><h2>Players</h2><p>Automatic Starting XI, bench and player profiles based on approved preferred positions.</p></div><section className="card"><div className="v2-toolbar"><div><p className="eyebrow">FORMATION</p><h3>Starting XI</h3></div><select value={formation} onChange={(e) => setFormation(e.target.value)}>{Object.keys(FORMATIONS).map((f) => <option key={f}>{f}</option>)}</select></div><div className="pitch-grid">{startingXI.map(({ slot, player }, index) => <button type="button" className={`pitch-card slot-${index}`} key={`${slot}-${index}`} disabled={!player} onClick={() => player && openPlayer(player)}><span>{slot}</span>{player ? <><strong>{player.name}</strong><small>#{player.jerseyNumber || "—"}</small>{player.stats?.ggRating != null && <b>{player.stats.ggRating} ★</b>}</> : <small>Open position</small>}</button>)}</div><div className="bench-wrap"><div className="v2-section-title"><div><p className="eyebrow">BENCH</p><h3>Squad Players</h3></div><span>{bench.length}</span></div><div className="bench-grid">{bench.map((player) => <button className="player-card" type="button" key={idOf(player)} onClick={() => openPlayer(player)}>{player.profileImage ? <img src={player.profileImage} alt="" /> : <div className="player-avatar">{initials(player.name)}</div>}<div><strong>{player.name}</strong><small>{player.preferredPositions?.join(" / ") || player.position || "Position not set"}</small></div></button>)}</div></div></section>{isAdmin && <section className="card"><div className="v2-section-title"><div><p className="eyebrow">ADMIN</p><h3>Position & El Clásico Requests</h3></div></div>{preferenceRequests.length === 0 ? <p className="muted">No pending preference requests.</p> : preferenceRequests.map((request) => <div className="request-card" key={request._id}><strong>{request.player?.name}</strong><span>{request.requestedBy?.email}</span><p>Positions: {(request.preferredPositions || []).join(", ") || "—"} · Side: {request.elClasicoSide || "—"}</p><div className="request-actions"><button type="button" className="save-button" onClick={() => reviewPreference(request._id, "approve")}>Approve</button><button type="button" className="secondary-button" onClick={() => reviewPreference(request._id, "reject")}>Reject</button></div></div>)}</section>}</section>
      )}

      {activeTab === TABS.GALLERY && (
        <section className="tab-content"><div className="page-title"><p className="eyebrow">GG MOMENTS</p><h2>Gallery</h2><p>Photos from the GG Matchday football archive.</p></div>{isSignedIn && <section className="card"><div className="v2-section-title"><div><p className="eyebrow">SHARE A MOMENT</p><h3>Add a Photo</h3></div></div><input type="file" accept="image/*" onChange={(e) => setGalleryFile(e.target.files?.[0] || null)} /><input value={galleryCaption} onChange={(e) => setGalleryCaption(e.target.value)} placeholder="Caption" /><div className="form-grid"><label><span>Match</span><select value={galleryMatchId} onChange={(e) => setGalleryMatchId(e.target.value)}><option value="">No match</option>{matches.map((m) => <option key={m._id} value={m._id}>{m.name} — {formatDate(m.date)}</option>)}</select></label><label><span>Player</span><select value={galleryPlayerId} onChange={(e) => setGalleryPlayerId(e.target.value)}><option value="">No player</option>{players.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label></div><button className="save-button" type="button" disabled={gallerySaving} onClick={uploadPhoto}>{gallerySaving ? "Uploading..." : "Add to Gallery"}</button></section>}{gallery.length === 0 ? <div className="empty-state"><span>📷</span><h3>No photos yet</h3><p>The first Matchday moment is waiting to be uploaded.</p></div> : <div className="v2-gallery-grid">{gallery.map((photo) => { const key = `gallery:${photo._id}`; return <article className="v2-gallery-card" key={photo._id}><img loading="lazy" src={photo.imageUrl} alt={photo.caption || "GG Matchday"} /><div><strong>{photo.caption || "Matchday moment"}</strong><small>{photo.matchId?.name || ""}{photo.playerId?.name ? ` · ${photo.playerId.name}` : ""}</small><div className="v2-like-row"><span>♥ {galleryLikes[key]?.count ?? 0}</span><button type="button" onClick={() => like("gallery", photo._id)}>{galleryLikes[key]?.likedByMe ? "Liked" : "Like"}</button></div></div></article>; })}</div>}</section>
      )}

      {selectedPlayer && activeTab === TABS.PLAYERS && <PlayerModal player={selectedPlayer} detail={playerDetail} loading={playerDetailLoading} aiReview={aiReview} aiReviewLoading={aiReviewLoading} onClose={() => setSelectedPlayer(null)} onGenerateReview={generatePlayerReview} canEdit={false} />}

      {calendarMatch && <MatchModal match={calendarMatch} detail={calendarMatchDetail} voted={Boolean(votedMatches[idOf(calendarMatch)])} onVote={vote} onClose={() => { setCalendarMatch(null); setCalendarMatchDetail(null); }} />}

      {awardModal && <AwardsModal year={awardYear} history={awardHistory} onYearChange={async (year) => { setAwardYear(Number(year)); await loadAwards(Number(year)); }} onClose={() => setAwardModal(false)} />}

      {preferenceData?.linkedPlayer && isSignedIn && activeTab === TABS.PLAYERS && selectedPlayer && idOf(selectedPlayer) === preferenceData.linkedPlayer && <PreferenceEditor positions={preferredPositions} setPositions={setPreferredPositions} side={clasicoSide} setSide={setClasicoSide} onSubmit={submitPreferences} saving={preferenceSaving} pending={Boolean(preferenceData.pending)} />}

      <footer className="pr-footer v2-footer">Made by <strong>Jeswin</strong></footer>

      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} isEditor={isEditor} />
    </main>
  );
}

function HomeStat({ label, value }) { return <div className="home-stat-card"><span>{label}</span><strong>{value}</strong></div>; }
function SectionHeading({ eyebrow, title, action, onAction }) { return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{action && <button type="button" className="text-action" onClick={onAction}>{action} →</button>}</div>; }
function AccessDenied({ title, description, signIn }) { return <div className="empty-state access-denied"><span>🔒</span><h3>{title}</h3><p>{description}</p>{signIn && <button type="button" className="google-button" onClick={signIn}>Continue with Google</button>}</div>; }
function Counter({ value, disabled, onChange }) { return <div className="v2-counter"><button type="button" disabled={disabled || value <= 0} onClick={() => onChange(Math.max(0, value - 1))}>−</button><strong>{value}</strong><button type="button" disabled={disabled} onClick={() => onChange(value + 1)}>+</button></div>; }
function ClasicoSide({ title, side }) { return <div className="clasico-side"><p className="eyebrow">{title}</p><h3>{side ? `${side.goals} goals` : "0 goals"}</h3><div className="clasico-stats"><span>Matches <b>{side?.matches || 0}</b></span><span>Wins <b>{side?.wins || 0}</b></span><span>Losses <b>{side?.losses || 0}</b></span><span>Assists <b>{side?.assists || 0}</b></span><span>Clean Sheets <b>{side?.cleanSheets || 0}</b></span></div><div className="clasico-players">{side?.players?.map((p) => <div key={p.playerId}><span>{p.name}</span><small>{p.goals} G · {p.assists} A</small></div>)}</div></div>; }

function PlayerModal({ player, detail, loading, aiReview, aiReviewLoading, onClose, onGenerateReview }) {
  return <div className="v2-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="v2-modal"><div className="v2-modal-head"><div><p className="eyebrow">PLAYER PROFILE</p><h2>{player.name}</h2><span>{player.position || "Position not set"}</span></div><button type="button" className="v2-close" onClick={onClose}>×</button></div>{loading ? <div className="loading-panel">Loading profile...</div> : detail && <><div className="player-detail-hero">{player.profileImage ? <img src={player.profileImage} alt="" /> : <div className="profile-photo-fallback">{initials(player.name)}</div>}<div><h3>{player.name}</h3><p>{detail.preferredPositions?.join(" / ") || player.position || "—"}</p></div></div><div className="v2-stat-grid"><span>GG Rating<strong>{detail.stats.ggRating ?? "—"}</strong></span><span>Performance<strong>{detail.stats.averageMatchRating ?? "—"}</strong></span><span>Offensive<strong>{detail.stats.offensiveRating}</strong></span><span>Defensive<strong>{detail.stats.defensiveRating}</strong></span><span>Results<strong>{detail.stats.resultScore?.toFixed?.(2) ?? detail.stats.resultScore}</strong></span><span>Matches<strong>{detail.stats.matches}</strong></span><span>Goals<strong>{detail.stats.goals}</strong></span><span>Assists<strong>{detail.stats.assists}</strong></span><span>Clean Sheets<strong>{detail.stats.cleanSheets}</strong></span></div><section><p className="eyebrow">AWARDS</p><div className="v2-chip-row">{detail.awards?.length ? detail.awards.map((award) => <span className="v2-chip" key={award._id}>{award.awardType.replaceAll("_", " ")} · {award.year}{award.month ? `/${award.month}` : ""}</span>) : <span className="muted">No stored awards yet.</span>}</div></section><section><p className="eyebrow">ACHIEVEMENTS</p><div className="v2-chip-row">{detail.achievements?.length ? detail.achievements.map((a) => <span className="v2-chip" key={a.id}>{a.label}</span>) : <span className="muted">No achievements unlocked yet.</span>}</div></section><section className="v2-ai-block"><div><p className="eyebrow">GG AI PLAYER REVIEW</p><h3>Editorial Review</h3></div><button className="secondary-button" type="button" disabled={aiReviewLoading} onClick={onGenerateReview}>{aiReviewLoading ? "Generating..." : "Generate AI Review"}</button>{aiReview && <p>{aiReview}</p>}</section></>}</section></div>;
}

function MatchModal({ match, detail, voted, onVote, onClose }) {
  const participants = detail?.match?.participants || match.participants || [];
  return <div className="v2-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="v2-modal"><div className="v2-modal-head"><div><p className="eyebrow">MATCH DAY</p><h2>{match.name}</h2><span>{formatDate(match.date)}</span></div><button type="button" className="v2-close" onClick={onClose}>×</button></div><div className="match-detail-score"><div><span>{match.teamA?.label}</span><strong>{match.teamA?.score}</strong></div><b>:</b><div><span>{match.teamB?.label}</span><strong>{match.teamB?.score}</strong></div></div><section><p className="eyebrow">PLAYER OF THE MATCH</p><h3>Vote for your POTM</h3>{voted ? <p className="muted">Your vote has been recorded.</p> : <div className="potm-list">{participants.map((item) => <button type="button" key={idOf(item.player)} onClick={() => onVote(idOf(match), idOf(item.player))}>{item.player?.name || "Player"}<span>{item.team === "A" ? match.teamA?.label : match.teamB?.label}</span></button>)}</div>}</section><section><p className="eyebrow">RATINGS</p><div className="v2-simple-list">{detail?.ratings?.map((item) => <div key={item._id}><span>{item.player?.name}</span><strong>{item.rating.toFixed(1)}</strong></div>)}</div></section></section></div>;
}

function AwardsModal({ year, history, onYearChange, onClose }) { const yearly = history.filter((a) => a.year === Number(year)); return <div className="v2-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="v2-modal"><div className="v2-modal-head"><div><p className="eyebrow">SHOWCASE</p><h2>Awards</h2></div><button type="button" className="v2-close" onClick={onClose}>×</button></div><select value={year} onChange={(e) => onYearChange(e.target.value)}>{[...new Set(history.map((a) => a.year).concat([year]))].sort((a,b)=>b-a).map((y)=><option key={y}>{y}</option>)}</select><div className="award-grid">{yearly.length ? yearly.map((award) => <article className="award-card" key={award._id}><span>{award.awardType.replaceAll("_", " ")}</span><strong>{award.player?.name || "—"}</strong><small>{award.rating != null ? `${award.rating} rating` : "Award holder"}</small></article>) : <div className="empty-state"><h3>No stored awards for {year}</h3></div>}</div></section></div>; }

function PreferenceEditor({ positions, setPositions, side, setSide, onSubmit, saving, pending }) { function toggle(position) { setPositions((current) => current.includes(position) ? current.filter((x) => x !== position) : [...current, position]); } return <div className="preference-editor card"><p className="eyebrow">MY PLAYER SETUP</p><h3>Preferred Positions</h3><div className="v2-chip-select">{POSITION_OPTIONS.map((p) => <button type="button" key={p} className={positions.includes(p) ? "active" : ""} onClick={() => toggle(p)}>{p}</button>)}</div><h3>El Clásico Side</h3><div className="v2-side-choice"><button type="button" className={side === "Messi" ? "active" : ""} onClick={() => setSide(side === "Messi" ? "" : "Messi")}>Messi</button><button type="button" className={side === "Ronaldo" ? "active" : ""} onClick={() => setSide(side === "Ronaldo" ? "" : "Ronaldo")}>Ronaldo</button></div><button className="save-button" type="button" disabled={saving || pending} onClick={onSubmit}>{pending ? "Request Pending" : saving ? "Submitting..." : "Submit for Approval"}</button></div>; }
function BottomNav({ activeTab, setActiveTab, isEditor }) { const items = [[TABS.HOME,"⌂","Home"],[TABS.RECORD,"＋","Record"],[TABS.LEADERBOARD,"🏆","Leaderboard"],[TABS.CALENDAR,"▣","Calendar"],[TABS.PLAYERS,"♟","Players"],[TABS.GALLERY,"▧","Gallery"]]; return <nav className="bottom-nav v2-bottom-nav">{items.filter(([key]) => key !== TABS.RECORD || isEditor).map(([key, icon, label]) => <button type="button" key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}><span>{icon}</span><small>{label}</small></button>)}</nav>; }
