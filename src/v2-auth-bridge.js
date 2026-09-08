import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

onAuthStateChanged(auth, async (user) => {
  window.__ggBackendUser = null;
  if (!user) {
    window.dispatchEvent(new Event("gg-auth-updated"));
    return;
  }
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    window.__ggBackendUser = data.user || null;
  } catch (error) {
    console.error("V2 auth bridge failed:", error);
  }
  window.dispatchEvent(new Event("gg-auth-updated"));
});
