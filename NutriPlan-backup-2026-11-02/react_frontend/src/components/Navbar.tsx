import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Leaf, Dumbbell, Search, BookmarkCheck, ArrowRightLeft, School, Moon, Sun } from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: Leaf },
  { to: "/gym", label: "Gym Planner", icon: Dumbbell },
  { to: "/recipes", label: "Recipes", icon: Search },
  { to: "/foodswap", label: "FoodSwap", icon: ArrowRightLeft },
  { to: "/campus", label: "Campus", icon: School },
  { to: "/my-plan", label: "My Plan", icon: BookmarkCheck },
];

export default function Navbar() {
  const { pathname } = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem("nutriplan.theme") === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("nutriplan.theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <nav className="sticky top-0 z-50 border-b bg-card/90 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold text-primary">
          <Leaf className="h-6 w-6" />
          NutriPlan
        </Link>
        <div className="hidden items-center gap-1 md:flex">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              aria-label={label}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                pathname === to
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2"><Link to="/fix-my-plate" className="hidden rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground md:inline-flex">Fix my plate</Link><button type="button" onClick={() => setDark((value) => !value)} aria-pressed={dark} aria-label={`Switch to ${dark ? "light" : "dark"} mode`} className="inline-flex h-10 w-10 items-center justify-center rounded-full border bg-card text-muted-foreground hover:text-foreground">{dark ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}</button></div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-8px_24px_-18px_hsl(var(--foreground)/0.35)] backdrop-blur-md md:hidden" aria-label="Main navigation">
        {[
          { to: "/", label: "Home", icon: Leaf },
          { to: "/foodswap", label: "Swap", icon: ArrowRightLeft },
          { to: "/recipes", label: "Recipes", icon: Search },
          { to: "/campus", label: "Campus", icon: School },
          { to: "/my-plan", label: "My Plan", icon: BookmarkCheck },
        ].map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} aria-current={pathname === to ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-semibold ${pathname === to ? "text-primary" : "text-muted-foreground"}`}>
            <Icon className="h-5 w-5" aria-hidden="true" /><span>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
