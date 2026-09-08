import { useEffect, useMemo, useState } from "react";
import { auth } from "./firebase";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const FORMATIONS = {
  "4-3-3": ["GK", "LB", "CB", "CB", "RB", "CM", "CM", "CAM", "LW", "ST", "RW"],
  "4-4-2": ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"],
  "4-2-3-1": ["GK", "LB", "CB", "CB", "RB", "CDM", "CDM", "LW", "CAM", "RW", "ST"],
  "3-5-2": ["GK", "CB", "CB", "CB", "LM", "CM", "CAM", "CM", "RM", "ST", "ST"],
};

function id(value) { return String(value?._id || value || ""); }
function authHeaders(token) { return { "Content-Type": "application/json", Authorization: `Bearer ${token}` }; }
async function getToken() { return auth.currentUser?.getIdToken(); }
async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

export default function V2Features() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState("squad");
  const [squad, setSquad] = useState([]);
  const [formation, setFormation] = useState("4-3-3");
  const [awards, setAwards] = useState(null);
  const [seasonYears, setSeasonYears] = useState([]);
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear());
  const [season, setSeason] = useState(null);
  const [elClasico, setElClasico] = useState(null);
  const [commentary, setCommentary] = useState("");
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [matches, setMatches] = useState([]);
  const [votes, setVotes] = useState({});
  const [voted, setVoted] = useState({});
  const [preferences, setPreferences] = useState(null);
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [selectedSide, setSelectedSide] = useState("");
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [adminRequests, setAdminRequests] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerProfile, setPlayerProfile] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [galleryAssociations, setGalleryAssociations] = useState({});
  const [message, setMessage] = useState("");

  const isAdmin = Boolean(window.__ggBackendUser?.role === "admin");
  const isSignedIn = Boolean(auth.currentUser);

  async function loadCore() {
    try {
      const [squadData, awardsData, seasonsData, matchesData, galleryData, clasicoData] = await Promise.all([
        getJson(`${API}/v2/squad`),
        getJson(`${API}/v2/awards?year=${new Date().getFullYear()}`),
        getJson(`${API}/v2/seasons`),
        getJson(`${API}/matches`),
        getJson(`${API}/gallery`),
        getJson(`${API}/v2/el-clasico`),
      ]);
      setSquad(squadData.players || []);
      setAwards(awardsData);
      setSeasonYears(seasonsData.seasons || []);
      setSeason(matchesData?.length ? new Date(matchesData[0].date).getUTCFullYear() : new Date().getFullYear());
      setMatches(matchesData || []);
      setGallery((galleryData || []).slice(0, 20));
      setElClasico(clasicoData);
      if (clasicoData) setSection((s) => s);
    } catch (error) {
      setMessage(error.message || "Could not load V2 data.");
    }
  }

  async function loadPreferences() {
    if (!auth.currentUser) return;
    try {
      const token = await getToken();
      const data = await getJson(`${API}/v2/preferences/me`, { headers: authHeaders(token) });
      setPreferences(data);
      setSelectedPositions(data.meta?.preferredPositions || []);
      setSelectedSide(data.meta?.elClasicoSide || "");
    } catch (error) { setMessage(error.message); }
  }

  async function loadAdminRequests() {
    if (!auth.currentUser || !isAdmin) return;
    try {
      const token = await getToken();
      setAdminRequests(await getJson(`${API}/v2/preferences/admin`, { headers: authHeaders(token) }));
    } catch (error) { setMessage(error.message); }
  }

  useEffect(() => { loadCore(); }, []);
  useEffect(() => { loadPreferences(); loadAdminRequests(); }, [open, isAdmin]);

  useEffect(() => {
    window.__ggBackendUser = window.__ggBackendUser || null;
    const event = () => { loadPreferences(); loadAdminRequests(); };
    window.addEventListener("gg-auth-updated", event);
    return () => window.removeEventListener("gg-auth-updated", event);
  }, []);

  const startingXI = useMemo(() => {
    const used = new Set();
    return FORMATIONS[formation].map((slot) => {
      const candidate = squad.find((player) => {
        const positions = player.preferredPositions?.length ? player.preferredPositions : [player.position].filter(Boolean);
        return !used.has(id(player)) && positions.includes(slot);
      });
      if (candidate) used.add(id(candidate));
      return { slot, player: candidate || null };
    });
  }, [formation, squad]);

  const bench = useMemo(() => squad.filter((player) => !startingXI.some((item) => item.player && id(item.player) === id(player))), [squad, startingXI]);

  async function openPlayer(player) {
    setSelectedPlayer(player);
    try { setPlayerProfile(await getJson(`${API}/v2/player/${id(player)}`)); } catch (error) { setMessage(error.message); }
  }

  async function submitPreferences() {
    if (!auth.currentUser || !preferences?.linkedPlayer) return;
    try {
      const token = await getToken();
      await getJson(`${API}/v2/preferences/me`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ preferredPositions: selectedPositions, elClasicoSide: selectedSide }),
      });
      setPreferenceMessage("Submitted for admin approval.");
      loadPreferences();
    } catch (error) { setPreferenceMessage(error.message); }
  }

  async function reviewPreference(request, action) {
    try {
      const token = await getToken();
      await getJson(`${API}/v2/preferences/admin/${request._id}/${action}`, {
        method: "POST", headers: authHeaders(token), body: JSON.stringify({}),
      });
      loadAdminRequests();
      loadCore();
    } catch (error) { setMessage(error.message); }
  }

  async function vote(matchId, playerId) {
    if (!auth.currentUser) { setMessage("Sign in to vote."); return; }
    if (voted[matchId]) return;
    try {
      const token = await getToken();
      await getJson(`${API}/v2/matches/${matchId}/potm`, {
        method: "POST", headers: authHeaders(token), body: JSON.stringify({ playerId }),
      });
      setVoted((current) => ({ ...current, [matchId]: playerId }));
      setVotes((current) => ({ ...current, [matchId]: { ...(current[matchId] || {}), [playerId]: ((current[matchId]?.[playerId] || 0) + 1) } }));
    } catch (error) { setMessage(error.message); }
  }

  async function loadVotes(matchId) {
    try {
      const data = await getJson(`${API}/v2/matches/${matchId}/potm`);
      setVotes((current) => ({ ...current, [matchId]: data.votes || {} }));
    } catch (error) { setMessage(error.message); }
  }

  async function generateCommentary() {
    if (!elClasico) return;
    try {
      setCommentaryLoading(true);
      const token = await getToken();
      const data = await getJson(`${API}/v2/el-clasico/commentary`, {
        method: "POST", headers: authHeaders(token), body: JSON.stringify({ data: { Messi: elClasico.sides?.Messi, Ronaldo: elClasico.sides?.Ronaldo } }),
      });
      setCommentary(data.commentary || "");
    } catch (error) { setMessage(error.message); } finally { setCommentaryLoading(false); }
  }

  async function loadSeason(year) {
    setSeasonYear(Number(year));
    try { setSeason(await getJson(`${API}/v2/seasons/${year}`)); } catch (error) { setMessage(error.message); }
  }

  async function associate(photoId) {
    try {
      const token = await getToken();
      const item = galleryAssociations[photoId] || {};
      await getJson(`${API}/v2/gallery/${photoId}/associate`, {
        method: "POST", headers: authHeaders(token), body: JSON.stringify({ matchId: item.matchId || null, playerId: item.playerId || null }),
      });
      setMessage("Gallery association saved.");
    } catch (error) { setMessage(error.message); }
  }

  const positionOptions = ["GK", "LB", "CB", "RB", "LWB", "RWB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "ST", "CF"];
  const matchPool = matches.filter((match) => match.participants?.length).slice(0, 10);

  return (
    <>
      <button className="v2-launch-button" type="button" onClick={() => setOpen(true)}>GG V2</button>
      {open && (
        <div className="v2-overlay" role="dialog" aria-modal="true">
          <div className="v2-panel">
            <div className="v2-header">
              <div><span className="eyebrow">GG MATCHDAY</span><h2>V2 Features</h2></div>
              <button className="v2-close" type="button" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="v2-tabs">
              {[["squad", "Squad"], ["leaderboard", "Ratings"], ["awards", "Awards"], ["elclasico", "El Clásico"], ["voting", "POTM"], ["season", "Seasons"], ["preferences", "My Setup"], ["gallery", "Gallery"]].map(([value, label]) => (
                <button key={value} type="button" className={section === value ? "active" : ""} onClick={() => setSection(value)}>{label}</button>
              ))}
            </div>

            {message && <div className="v2-message"><span>{message}</span><button type="button" onClick={() => setMessage("")}>×</button></div>}

            {section === "squad" && (
              <section>
                <div className="v2-toolbar"><div><span className="eyebrow">SQUAD</span><h3>Starting XI</h3></div><select value={formation} onChange={(e) => setFormation(e.target.value)}>{Object.keys(FORMATIONS).map((name) => <option key={name}>{name}</option>)}</select></div>
                <div className="pitch">
                  {startingXI.map(({ slot, player }, index) => (
                    <button key={`${slot}-${index}`} type="button" className={`pitch-player pitch-${slot.toLowerCase()}`} onClick={() => player && openPlayer(player)} disabled={!player}>
                      <span className="pitch-slot">{slot}</span>
                      {player ? <><strong>{player.name}</strong><small>{player.jerseyNumber ? `#${player.jerseyNumber}` : player.position || "Player"}</small></> : <small>Open</small>}
                    </button>
                  ))}
                </div>
                <div className="v2-bench"><h3>Bench</h3><div className="v2-bench-grid">{bench.map((player) => <button type="button" key={id(player)} className="v2-player-card" onClick={() => openPlayer(player)}><strong>{player.name}</strong><small>{player.preferredPositions?.join(" / ") || player.position || "—"}</small></button>)}</div></div>
                {selectedPlayer && playerProfile && <div className="v2-profile-card"><button className="v2-close-small" type="button" onClick={() => setSelectedPlayer(null)}>×</button><div className="v2-profile-head">{selectedPlayer.profileImage ? <img src={selectedPlayer.profileImage} alt="" /> : <div className="v2-avatar">{selectedPlayer.name?.[0]}</div>}<div><h3>{selectedPlayer.name}</h3><small>{selectedPlayer.position || "Player"}</small></div></div><div className="v2-stat-grid"><span>MP<strong>{playerProfile.stats.matches}</strong></span><span>G<strong>{playerProfile.stats.goals}</strong></span><span>A<strong>{playerProfile.stats.assists}</strong></span><span>CS<strong>{playerProfile.stats.cleanSheets}</strong></span><span>Rating<strong>{playerProfile.stats.ggRating ?? "—"}</strong></span><span>Offensive<strong>{playerProfile.stats.offensiveRating}</strong></span><span>Defensive<strong>{playerProfile.stats.defensiveRating}</strong></span><span>Results<strong>{playerProfile.stats.resultScore?.toFixed?.(2) ?? playerProfile.stats.resultScore}</strong></span></div><div><span className="eyebrow">ACHIEVEMENTS</span><div className="v2-chip-row">{playerProfile.achievements?.map((item) => <span className="v2-chip" key={item.id}>{item.label}</span>)}</div></div><div className="v2-profile-note">Preferred positions: {playerProfile.preferredPositions?.join(" / ") || "Not submitted"}</div></div>}
              </section>
            )}

            {section === "leaderboard" && (
              <section><div className="v2-toolbar"><div><span className="eyebrow">GG RATING</span><h3>Top Players</h3></div></div><div className="v2-table">{squad.slice().sort((a,b) => (b.stats?.ggRating ?? -1) - (a.stats?.ggRating ?? -1)).map((player, index) => <div className="v2-table-row" key={id(player)}><span>{index + 1}</span><strong>{player.name}</strong><small>{player.position || "—"}</small><small>{player.stats?.matches ?? 0} MP</small><b>{player.stats?.ggRating ?? "—"}{player.stats?.ggRating !== null && player.stats?.ggRating !== undefined ? " ★" : ""}</b></div>)}</div></section>
            )}

            {section === "awards" && (
              <section><div className="v2-toolbar"><div><span className="eyebrow">SHOWCASE</span><h3>V2 Awards</h3></div><select value={seasonYear} onChange={(e) => { setSeasonYear(Number(e.target.value)); loadSeason(e.target.value); }}>{(seasonYears.length ? seasonYears : [new Date().getFullYear()]).map((year) => <option key={year} value={year}>{year}</option>)}</select></div><div className="v2-award-grid">{[["Player of the Year", awards?.playerOfYear], ["Best Offensive", awards?.bestOffensive], ["Best Defensive", awards?.bestDefensive]].map(([label, winner]) => <article className="v2-award-card" key={label}><span>{label}</span><strong>{winner?.name || "TBD"}</strong><small>{winner?.ggRating != null ? `${winner.ggRating} rating` : winner?.offensiveRating != null ? `${winner.offensiveRating} offensive rating` : "No eligible winner"}</small></article>)}</div><p className="v2-note">Player of the Month remains rating-based. Match-level POTM is determined by the one-vote-per-account system.</p></section>
            )}

            {section === "elclasico" && (
              <section><div className="v2-toolbar"><div><span className="eyebrow">RIVALRY</span><h3>El Clásico</h3></div><button className="v2-primary" type="button" onClick={generateCommentary} disabled={commentaryLoading}>{commentaryLoading ? "Commentating..." : "Generate Commentary"}</button></div><div className="v2-rivalry-grid">{["Messi", "Ronaldo"].map((side) => { const data = elClasico?.sides?.[side] || {}; return <article className="v2-rivalry-card" key={side}><span>{side} Fans</span><strong>{data.goals || 0} goals</strong><div><small>{data.assists || 0} assists</small><small>{data.wins || 0} wins</small><small>{data.losses || 0} losses</small><small>{data.cleanSheets || 0} clean sheets</small></div><div className="v2-contributors">{(data.players || []).slice(0, 5).map((p) => <span key={p.playerId}>{p.name} · {p.goals}G {p.assists}A</span>)}</div></article>; })}</div>{commentary && <article className="v2-ai-card"><span className="eyebrow">GG MATCHDAY AI</span><p>{commentary}</p></article>}<h3>El Clásico Match Records</h3><div className="v2-list">{(elClasico?.matches || []).map((match) => <div className="v2-list-row" key={id(match)}><strong>{match.name}</strong><span>{match.teamA?.label} {match.teamA?.score} — {match.teamB?.score} {match.teamB?.label}</span></div>)}</div></section>
            )}

            {section === "voting" && (
              <section><div className="v2-toolbar"><div><span className="eyebrow">MATCH AWARDS</span><h3>Player of the Match</h3></div></div><div className="v2-voting-list">{matchPool.map((match) => { if (!votes[id(match)]) void loadVotes(id(match)); return <article className="v2-vote-card" key={id(match)}><div><strong>{match.name}</strong><small>{new Date(match.date).toLocaleDateString()}</small></div><div className="v2-vote-options">{(match.participants || []).map((participant) => { const player = participant.player; const playerId = id(player); const count = votes[id(match)]?.[playerId] || 0; return <button key={playerId} type="button" onClick={() => vote(id(match), playerId)} disabled={Boolean(voted[id(match)])}><span>{player?.name || "Player"}</span><b>{count}</b></button>; })}</div>{voted[id(match)] && <small className="v2-muted">Your vote is recorded and cannot be changed.</small>}</article>; })}</div></section>
            )}

            {section === "season" && (
              <section><div className="v2-toolbar"><div><span className="eyebrow">SEASON ARCHIVE</span><h3>{seasonYear} Season</h3></div><select value={seasonYear} onChange={(e) => loadSeason(e.target.value)}>{(seasonYears.length ? seasonYears : [new Date().getFullYear()]).map((year) => <option key={year} value={year}>{year}</option>)}</select></div>{season ? <><div className="v2-season-summary"><span>Matches<strong>{season.matches?.length || 0}</strong></span><span>Players<strong>{season.stats?.length || 0}</strong></span></div><div className="v2-table">{(season.stats || []).slice(0, 15).map((player, index) => <div className="v2-table-row" key={player.playerId}><span>{index + 1}</span><strong>{player.name}</strong><small>{player.matches} MP</small><small>{player.goals} G</small><small>{player.assists} A</small><b>{player.ggRating ?? "—"}</b></div>)}</div></> : <p className="v2-note">Select a calendar year to load its statistics and stored awards.</p>}</section>
            )}

            {section === "preferences" && (
              <section><div className="v2-toolbar"><div><span className="eyebrow">PROFILE SETUP</span><h3>My Football Preferences</h3></div></div>{!isSignedIn ? <p className="v2-note">Sign in to submit your preferred positions and El Clásico side.</p> : !preferences?.linkedPlayer ? <p className="v2-note">Your Google account has not been linked to a player by the admin yet.</p> : <><div className="v2-linked-card"><strong>Linked player</strong><span>{squad.find((p) => id(p) === preferences.linkedPlayer)?.name || "Your player"}</span></div><p className="v2-note">Choose the positions you prefer. Multiple positions are allowed; the admin must approve changes before they become official.</p><div className="v2-position-grid">{positionOptions.map((position) => <button key={position} type="button" className={selectedPositions.includes(position) ? "active" : ""} onClick={() => setSelectedPositions((current) => current.includes(position) ? current.filter((value) => value !== position) : [...current, position].slice(0, 5))}>{position}</button>)}</div><div className="v2-side-choice"><button type="button" className={selectedSide === "Messi" ? "active" : ""} onClick={() => setSelectedSide("Messi")}>Messi Fans</button><button type="button" className={selectedSide === "Ronaldo" ? "active" : ""} onClick={() => setSelectedSide("Ronaldo")}>Ronaldo Fans</button></div>{preferenceMessage && <p className="v2-success">{preferenceMessage}</p>}<button type="button" className="v2-primary" onClick={submitPreferences}>Submit for Approval</button></>}</section>
            )}

            {section === "gallery" && (
              <section><div className="v2-toolbar"><div><span className="eyebrow">ARCHIVE</span><h3>Gallery Associations</h3></div></div><div className="v2-gallery-list">{gallery.map((photo) => { const current = galleryAssociations[photo._id] || { matchId: photo.matchId?._id || "", playerId: photo.playerId?._id || "" }; return <article className="v2-gallery-row" key={photo._id}><img src={photo.imageUrl} alt={photo.caption || "GG Matchday"} loading="lazy"/><div><strong>{photo.caption || "Untitled moment"}</strong><small>{photo.uploadedByName || "GG Matchday"}</small><div className="v2-gallery-controls"><select value={current.matchId} onChange={(e) => setGalleryAssociations((all) => ({ ...all, [photo._id]: { ...current, matchId: e.target.value } }))}><option value="">No match</option>{matches.map((match) => <option key={id(match)} value={id(match)}>{match.name}</option>)}</select><select value={current.playerId} onChange={(e) => setGalleryAssociations((all) => ({ ...all, [photo._id]: { ...current, playerId: e.target.value } }))}><option value="">No player</option>{squad.map((player) => <option key={id(player)} value={id(player)}>{player.name}</option>)}</select><button type="button" className="v2-secondary" onClick={() => associate(photo._id)} disabled={!auth.currentUser}>Save</button></div></div></article>; })}</div></section>
            )}

            {isAdmin && <section className="v2-admin-requests"><div className="v2-toolbar"><div><span className="eyebrow">ADMIN</span><h3>Position / El Clásico Requests</h3></div><span>{adminRequests.length}</span></div>{adminRequests.length === 0 ? <p className="v2-note">No pending V2 preference requests.</p> : adminRequests.map((request) => <div className="v2-request-row" key={request._id}><div><strong>{request.player?.name}</strong><small>{request.requestedBy?.email}</small></div><span>{request.preferredPositions?.join(", ") || "—"} {request.elClasicoSide ? `· ${request.elClasicoSide}` : ""}</span><div><button className="v2-primary" type="button" onClick={() => reviewPreference(request, "approve")}>Approve</button><button className="v2-secondary" type="button" onClick={() => reviewPreference(request, "reject")}>Reject</button></div></div>)}</section>}
          </div>
        </div>
      )}
    </>
  );
}
