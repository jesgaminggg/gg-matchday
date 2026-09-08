import { useEffect, useMemo, useState } from "react";
import { auth } from "./firebase";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const FORMATIONS = {
  "4-3-3": ["GK", "LB", "CB", "CB", "RB", "CM", "CM", "CAM", "LW", "ST", "RW"],
  "4-4-2": ["GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"],
  "4-2-3-1": ["GK", "LB", "CB", "CB", "RB", "CDM", "CDM", "LW", "CAM", "RW", "ST"],
  "3-5-2": ["GK", "CB", "CB", "CB", "LM", "CM", "CAM", "CM", "RM", "ST", "ST"],
};
function key(v) { return String(v?._id || v || ""); }
function headers(token) { return { "Content-Type": "application/json", Authorization: `Bearer ${token}` }; }
async function json(url, options) { const r = await fetch(url, options); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || `Request failed (${r.status})`); return d; }
async function token() { return auth.currentUser?.getIdToken(); }

export default function V2FeaturesSafe() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("squad");
  const [backendUser, setBackendUser] = useState(() => window.__ggBackendUser || null);
  const [squad, setSquad] = useState([]);
  const [formation, setFormation] = useState("4-3-3");
  const [awards, setAwards] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear());
  const [season, setSeason] = useState(null);
  const [elClasico, setElClasico] = useState(null);
  const [commentary, setCommentary] = useState("");
  const [matches, setMatches] = useState([]);
  const [votes, setVotes] = useState({});
  const [voted, setVoted] = useState({});
  const [preferences, setPreferences] = useState(null);
  const [positions, setPositions] = useState([]);
  const [side, setSide] = useState("");
  const [requests, setRequests] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [galleryEdits, setGalleryEdits] = useState({});
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const isAdmin = backendUser?.role === "admin";
  const signedIn = Boolean(auth.currentUser);

  useEffect(() => {
    const handler = () => setBackendUser(window.__ggBackendUser || null);
    window.addEventListener("gg-auth-updated", handler);
    return () => window.removeEventListener("gg-auth-updated", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setBusy(true);
        const [s, a, ys, m, g, e] = await Promise.all([
          json(`${API}/v2/squad`),
          json(`${API}/v2/awards?year=${new Date().getFullYear()}`),
          json(`${API}/v2/seasons`),
          json(`${API}/matches`),
          json(`${API}/gallery`),
          json(`${API}/v2/el-clasico`),
        ]);
        setSquad(s.players || []); setAwards(a); setSeasons(ys.seasons || []); setMatches(m || []); setGallery((g || []).slice(0, 30)); setElClasico(e);
      } catch (e) { setNotice(e.message); } finally { setBusy(false); }
    })();
  }, [open]);

  useEffect(() => {
    if (!open || !signedIn) return;
    (async () => {
      try {
        const t = await token();
        const p = await json(`${API}/v2/preferences/me`, { headers: headers(t) });
        setPreferences(p); setPositions(p.meta?.preferredPositions || []); setSide(p.meta?.elClasicoSide || "");
      } catch (e) { setNotice(e.message); }
    })();
  }, [open, signedIn]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    (async () => {
      try { const t = await token(); setRequests(await json(`${API}/v2/preferences/admin`, { headers: headers(t) })); }
      catch (e) { setNotice(e.message); }
    })();
  }, [open, isAdmin]);

  useEffect(() => {
    if (tab !== "season") return;
    (async () => { try { setSeason(await json(`${API}/v2/seasons/${seasonYear}`)); } catch (e) { setNotice(e.message); } })();
  }, [tab, seasonYear]);

  useEffect(() => {
    if (tab !== "voting") return;
    const pool = matches.filter((m) => m.participants?.length).slice(0, 10);
    pool.forEach((m) => {
      const mid = key(m);
      if (votes[mid]) return;
      json(`${API}/v2/matches/${mid}/potm`).then((d) => setVotes((v) => ({ ...v, [mid]: d.votes || {} }))).catch((e) => setNotice(e.message));
    });
  }, [tab, matches, votes]);

  const startingXI = useMemo(() => {
    const used = new Set();
    return (FORMATIONS[formation] || FORMATIONS["4-3-3"]).map((slot) => {
      const player = squad.find((p) => {
        const preferred = p.preferredPositions?.length ? p.preferredPositions : [p.position].filter(Boolean);
        return !used.has(key(p)) && preferred.includes(slot);
      });
      if (player) used.add(key(player));
      return { slot, player: player || null };
    });
  }, [formation, squad]);
  const bench = squad.filter((p) => !startingXI.some((s) => s.player && key(s.player) === key(p)));
  const topGoals = [...squad].sort((a,b) => (b.stats?.goals || 0) - (a.stats?.goals || 0))[0];
  const topAssists = [...squad].sort((a,b) => (b.stats?.assists || 0) - (a.stats?.assists || 0))[0];

  async function openPlayer(player) { setSelectedPlayer(player); try { setProfile(await json(`${API}/v2/player/${key(player)}`)); } catch (e) { setNotice(e.message); } }
  async function submitPreferences() { try { const t = await token(); await json(`${API}/v2/preferences/me`, { method: "POST", headers: headers(t), body: JSON.stringify({ preferredPositions: positions, elClasicoSide: side }) }); setNotice("Submitted for admin approval."); } catch (e) { setNotice(e.message); } }
  async function review(idValue, action) { try { const t = await token(); await json(`${API}/v2/preferences/admin/${idValue}/${action}`, { method: "POST", headers: headers(t), body: JSON.stringify({}) }); const updated = await json(`${API}/v2/preferences/admin`, { headers: headers(t) }); setRequests(updated); const s = await json(`${API}/v2/squad`); setSquad(s.players || []); } catch (e) { setNotice(e.message); } }
  async function vote(mid, pid) { if (!signedIn || voted[mid]) return; try { const t = await token(); await json(`${API}/v2/matches/${mid}/potm`, { method: "POST", headers: headers(t), body: JSON.stringify({ playerId: pid }) }); setVoted((v) => ({ ...v, [mid]: pid })); setNotice("POTM vote recorded. You cannot change it."); } catch (e) { setNotice(e.message); } }
  async function commentaryRun() { try { setBusy(true); const t = await token(); const d = await json(`${API}/v2/el-clasico/commentary`, { method: "POST", headers: headers(t), body: JSON.stringify({ data: { Messi: elClasico?.sides?.Messi, Ronaldo: elClasico?.sides?.Ronaldo } }) }); setCommentary(d.commentary || ""); } catch (e) { setNotice(e.message); } finally { setBusy(false); } }
  async function associate(pid) { try { const t = await token(); const v = galleryEdits[pid] || {}; await json(`${API}/v2/gallery/${pid}/associate`, { method: "POST", headers: headers(t), body: JSON.stringify({ matchId: v.matchId || null, playerId: v.playerId || null }) }); setNotice("Gallery association saved."); } catch (e) { setNotice(e.message); } }

  return <>
    <button className="v2-launch-button" type="button" onClick={() => setOpen(true)}>GG V2</button>
    {open && <div className="v2-overlay" role="dialog" aria-modal="true">
      <div className="v2-panel">
        <div className="v2-header"><div><span className="eyebrow">GG MATCHDAY</span><h2>V2</h2></div><button className="v2-close" type="button" onClick={() => setOpen(false)}>×</button></div>
        <div className="v2-tabs">{[["squad","Squad"],["leaderboard","Ratings"],["awards","Awards"],["elclasico","El Clásico"],["voting","POTM"],["season","Seasons"],["preferences","My Setup"],["gallery","Gallery"]].map(([v,l]) => <button key={v} className={tab === v ? "active" : ""} type="button" onClick={() => setTab(v)}>{l}</button>)}</div>
        {notice && <div className="v2-message"><span>{notice}</span><button type="button" onClick={() => setNotice("")}>×</button></div>}
        {busy && <div className="v2-note">Updating GG Matchday…</div>}

        {tab === "squad" && <section><div className="v2-toolbar"><div><span className="eyebrow">SQUAD</span><h3>Starting XI</h3></div><select value={formation} onChange={(e) => setFormation(e.target.value)}>{Object.keys(FORMATIONS).map((f) => <option key={f}>{f}</option>)}</select></div><div className="pitch">{startingXI.map(({ slot, player }, i) => <button key={`${slot}-${i}`} type="button" className="pitch-player" onClick={() => player && openPlayer(player)} disabled={!player}><span className="pitch-slot">{slot}</span><strong>{player?.name || "Open"}</strong><small>{player ? (player.jerseyNumber ? `#${player.jerseyNumber}` : player.position || "Player") : "Unassigned"}</small></button>)}</div><div className="v2-bench"><h3>Bench</h3><div className="v2-bench-grid">{bench.map((p) => <button className="v2-player-card" type="button" key={key(p)} onClick={() => openPlayer(p)}><strong>{p.name}</strong><small>{p.preferredPositions?.join(" / ") || p.position || "—"}</small></button>)}</div></div>{selectedPlayer && profile && <div className="v2-profile-card"><button className="v2-close-small" type="button" onClick={() => setSelectedPlayer(null)}>×</button><div className="v2-profile-head">{selectedPlayer.profileImage ? <img src={selectedPlayer.profileImage} alt=""/> : <div className="v2-avatar">{selectedPlayer.name?.[0]}</div>}<div><h3>{selectedPlayer.name}</h3><small>{selectedPlayer.position || "Player"}</small></div></div><div className="v2-stat-grid"><span>MP<strong>{profile.stats.matches}</strong></span><span>G<strong>{profile.stats.goals}</strong></span><span>A<strong>{profile.stats.assists}</strong></span><span>CS<strong>{profile.stats.cleanSheets}</strong></span><span>GG Rating<strong>{profile.stats.ggRating ?? "—"}</strong></span><span>Offensive<strong>{profile.stats.offensiveRating}</strong></span><span>Defensive<strong>{profile.stats.defensiveRating}</strong></span><span>Results<strong>{profile.stats.resultScore?.toFixed?.(2) ?? profile.stats.resultScore}</strong></span></div><span className="eyebrow">ACHIEVEMENTS</span><div className="v2-chip-row">{(profile.achievements || []).map((a) => <span className="v2-chip" key={a.id}>{a.label}</span>)}</div><p className="v2-profile-note">Preferred positions: {profile.stats.preferredPositions?.join(" / ") || "Not approved"}</p></div>}</section>}

        {tab === "leaderboard" && <section><div className="v2-toolbar"><div><span className="eyebrow">GG RATING</span><h3>Overall Rankings</h3></div></div><div className="v2-table">{[...squad].sort((a,b) => (b.stats?.ggRating ?? -1) - (a.stats?.ggRating ?? -1)).map((p,i) => <div className="v2-table-row" key={key(p)}><span>{i+1}</span><strong>{p.name}</strong><small>{p.position || "—"}</small><small>{p.stats?.matches || 0} MP</small><b>{p.stats?.ggRating ?? "—"}{p.stats?.ggRating != null ? " ★" : ""}</b></div>)}</div><p className="v2-note">GG Rating: 40% match performance, 20% offensive, 20% defensive, 20% team results. Players need 5 matches and rated performances to receive a full rating.</p></section>}

        {tab === "awards" && <section><div className="v2-toolbar"><div><span className="eyebrow">AWARDS SHOWCASE</span><h3>{new Date().getFullYear()} Award Holders</h3></div></div><div className="v2-award-grid">{[["Golden Boot", topGoals?.name], ["Assist Leader", topAssists?.name], ["Player of the Year", awards?.playerOfYear?.name], ["Best Offensive Player", awards?.bestOffensive?.name], ["Best Defensive Player", awards?.bestDefensive?.name], ["Player of the Month", "Voting / monthly cycle"]].map(([label,name]) => <article className="v2-award-card" key={label}><span>{label}</span><strong>{name || "TBD"}</strong><small>{label === "Golden Boot" ? `${topGoals?.stats?.goals || 0} goals` : label === "Assist Leader" ? `${topAssists?.stats?.assists || 0} assists` : "Official GG award"}</small></article>)}</div><p className="v2-note">Match-level Player of the Match is user-voted and is separate from the rating formula.</p></section>}

        {tab === "elclasico" && <section><div className="v2-toolbar"><div><span className="eyebrow">RIVALRY</span><h3>El Clásico</h3></div><button className="v2-primary" type="button" onClick={commentaryRun} disabled={!signedIn || busy}>Generate Commentary</button></div><div className="v2-rivalry-grid">{["Messi","Ronaldo"].map((s) => { const d = elClasico?.sides?.[s] || {}; return <article className="v2-rivalry-card" key={s}><span>{s} Fans</span><strong>{d.goals || 0} goals</strong><div><small>{d.assists || 0} assists</small><small>{d.wins || 0} wins</small><small>{d.losses || 0} losses</small><small>{d.cleanSheets || 0} clean sheets</small></div><div className="v2-contributors">{(d.players || []).slice(0,8).map((p) => <span key={p.playerId}>{p.name} · {p.goals}G {p.assists}A</span>)}</div></article>; })}</div>{commentary && <article className="v2-ai-card"><span className="eyebrow">GG MATCHDAY AI</span><p>{commentary}</p></article>}<h3>Match Records</h3><div className="v2-list">{(elClasico?.matches || []).map((m) => <div className="v2-list-row" key={key(m)}><strong>{m.name}</strong><span>{m.teamA?.label} {m.teamA?.score} — {m.teamB?.score} {m.teamB?.label}</span></div>)}</div></section>}

        {tab === "voting" && <section><div className="v2-toolbar"><div><span className="eyebrow">MATCH AWARD</span><h3>Player of the Match</h3></div></div><div className="v2-voting-list">{matches.filter((m) => m.participants?.length).slice(0,10).map((m) => <article className="v2-vote-card" key={key(m)}><div><strong>{m.name}</strong><small>{new Date(m.date).toLocaleDateString()}</small></div><div className="v2-vote-options">{(m.participants || []).map((p) => { const pid = key(p.player); return <button type="button" key={pid} disabled={!signedIn || Boolean(voted[key(m)])} onClick={() => vote(key(m), pid)}><span>{p.player?.name || "Player"}</span><b>{votes[key(m)]?.[pid] || 0}</b></button>; })}</div>{voted[key(m)] && <small className="v2-muted">Vote recorded. One vote per account.</small>}</article>)}</div></section>}

        {tab === "season" && <section><div className="v2-toolbar"><div><span className="eyebrow">SEASON ARCHIVE</span><h3>{seasonYear} Season</h3></div><select value={seasonYear} onChange={(e) => setSeasonYear(Number(e.target.value))}>{(seasons.length ? seasons : [new Date().getFullYear()]).map((y) => <option key={y}>{y}</option>)}</select></div>{season ? <><div className="v2-season-summary"><span>Matches<strong>{season.matches?.length || 0}</strong></span><span>Players<strong>{season.stats?.length || 0}</strong></span></div><div className="v2-table">{(season.stats || []).slice(0,20).map((p,i) => <div className="v2-table-row" key={p.playerId}><span>{i+1}</span><strong>{p.name}</strong><small>{p.matches} MP</small><small>{p.goals} G / {p.assists} A</small><b>{p.ggRating ?? "—"}</b></div>)}</div></> : <p className="v2-note">No matches have been recorded for this calendar year yet.</p>}</section>}

        {tab === "preferences" && <section><div className="v2-toolbar"><div><span className="eyebrow">PROFILE SETUP</span><h3>Positions & El Clásico Side</h3></div></div>{!signedIn ? <p className="v2-note">Sign in first.</p> : !preferences?.linkedPlayer ? <p className="v2-note">Your account must be linked to a player by the admin before these settings can be submitted.</p> : <><div className="v2-linked-card"><strong>Linked player</strong><span>{squad.find((p) => key(p) === String(preferences.linkedPlayer))?.name || "Player"}</span></div><p className="v2-note">Select multiple positions. Position and El Clásico preferences stay pending until the admin approves them.</p><div className="v2-position-grid">{["GK","LB","CB","RB","LWB","RWB","CDM","CM","CAM","LM","RM","LW","RW","ST","CF"].map((p) => <button key={p} type="button" className={positions.includes(p) ? "active" : ""} onClick={() => setPositions((v) => v.includes(p) ? v.filter((x) => x !== p) : [...v,p].slice(0,5))}>{p}</button>)}</div><div className="v2-side-choice"><button type="button" className={side === "Messi" ? "active" : ""} onClick={() => setSide("Messi")}>Messi Fans</button><button type="button" className={side === "Ronaldo" ? "active" : ""} onClick={() => setSide("Ronaldo")}>Ronaldo Fans</button></div><button className="v2-primary" type="button" onClick={submitPreferences}>Submit for Approval</button></>}</section>}

        {tab === "gallery" && <section><div className="v2-toolbar"><div><span className="eyebrow">ARCHIVE</span><h3>Photo Associations</h3></div></div><div className="v2-gallery-list">{gallery.map((p) => { const current = galleryEdits[p._id] || { matchId: p.matchId?._id || "", playerId: p.playerId?._id || "" }; return <article className="v2-gallery-row" key={p._id}><img src={p.imageUrl} alt={p.caption || "GG Matchday"} loading="lazy"/><div><strong>{p.caption || "Untitled moment"}</strong><small>{p.uploadedByName || "GG Matchday"}</small><div className="v2-gallery-controls"><select value={current.matchId} onChange={(e) => setGalleryEdits((all) => ({...all,[p._id]:{...current,matchId:e.target.value}}))}><option value="">No match</option>{matches.map((m) => <option key={key(m)} value={key(m)}>{m.name}</option>)}</select><select value={current.playerId} onChange={(e) => setGalleryEdits((all) => ({...all,[p._id]:{...current,playerId:e.target.value}}))}><option value="">No player</option>{squad.map((x) => <option key={key(x)} value={key(x)}>{x.name}</option>)}</select><button type="button" className="v2-secondary" onClick={() => associate(p._id)} disabled={!signedIn}>Save</button></div></div></article>; })}</div></section>}

        {isAdmin && <section className="v2-admin-requests"><div className="v2-toolbar"><div><span className="eyebrow">ADMIN</span><h3>Preference Requests</h3></div><span>{requests.length}</span></div>{requests.length === 0 ? <p className="v2-note">No pending position / El Clásico requests.</p> : requests.map((r) => <div className="v2-request-row" key={r._id}><div><strong>{r.player?.name}</strong><small>{r.requestedBy?.email}</small></div><span>{r.preferredPositions?.join(" / ") || "—"}{r.elClasicoSide ? ` · ${r.elClasicoSide}` : ""}</span><div><button className="v2-primary" type="button" onClick={() => review(r._id,"approve")}>Approve</button><button className="v2-secondary" type="button" onClick={() => review(r._id,"reject")}>Reject</button></div></div>)}</section>}
      </div>
    </div>}
  </>;
}
