import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { logout } from "./api";

/** The brand bar, with the signed-in user's menu. */
export default function Topbar({ username }: { username: string }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the user menu on any outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function signOut() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="/dashboard" aria-label="Go to bookings">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="topbar-logo" src="/logo.svg" alt="Innospace Tirana" />
          <span className="brand-sub">Bookings</span>
        </a>
        <div className="user-menu">
          <button
            className="user-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="avatar">{username.charAt(0).toUpperCase()}</span>
            <span className="user-name">{username}</span>
            <span className="caret">▾</span>
          </button>
          {menuOpen && (
            <div className="user-dropdown" role="menu">
              <div className="user-dropdown-head">
                Signed in as
                <strong>{username}</strong>
              </div>
              <button className="user-dropdown-item" onClick={signOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
