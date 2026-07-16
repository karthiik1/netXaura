// Landing: create a workspace or join with a code (§7.1). The signature element
// is the transmission tag — a monospace workspace code framed like a channel ID.
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight, Hash, User } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../../services/api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { SunsetCityscape } from "../landing/SunsetCityscape";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

export function WorkspaceJoinScreen() {
  const nav = useNavigate();
  const setIdentity = useWorkspaceStore((s) => s.setIdentity);
  // Always start blank — the remembered name stays in the store, but the field
  // shouldn't come pre-filled.
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  async function create() {
    if (!name.trim()) return setError("Enter a display name first.");
    setBusy("create");
    setError(null);
    try {
      setIdentity(name.trim());
      const ws = await api.createWorkspace();
      nav(`/w/${ws.code}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create workspace.");
    } finally {
      setBusy(null);
    }
  }

  async function join() {
    if (!name.trim()) return setError("Enter a display name first.");
    if (code.trim().length !== 6) return setError("Codes are 6 characters.");
    setBusy("join");
    setError(null);
    try {
      setIdentity(name.trim());
      nav(`/w/${code.trim().toUpperCase()}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not join.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      {/* Low-poly sunset cityscape fills the screen; the UI floats as glass
          above it. A soft scrim keeps the card and copy legible. */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <SunsetCityscape />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/45 via-ink/15 to-ink/55" />
      </div>

      <div className="relative z-[1] flex w-full max-w-md flex-col items-center text-center">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="mb-2 bg-gradient-to-br from-ink50 via-ink50 to-aura bg-clip-text font-display text-6xl font-semibold tracking-tight text-transparent sm:text-7xl"
        >
          net<span className="bg-gradient-to-br from-aura to-signal bg-clip-text text-transparent">X</span>aura
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
          className="mb-12 font-mono text-xs uppercase tracking-[0.35em] text-muted"
        >
          Connect. Gesture. Transfer
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
          className="w-full rounded-[28px] bg-gradient-to-br from-white/25 via-white/5 to-white/25 p-px shadow-premium"
        >
          <div className="glass-strong rounded-[27px] border-0 p-8">
            <label className="mb-1.5 block text-left font-mono text-xs font-medium text-ink50/90">
              Display Name
            </label>
            <Input
              icon={<User className="h-4 w-4" />}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Karthik"
              wrapperClassName="mb-5"
            />

            <Button
              variant="primary"
              className="mb-7 w-full py-3.5 text-[15px]"
              loading={busy === "create"}
              disabled={busy !== null}
              onClick={create}
            >
              Create a workspace
              {busy !== "create" && <ArrowRight className="h-4 w-4" />}
            </Button>

            <div className="mb-5 flex items-center gap-3 text-muted">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent to-line" />
              <span className="font-mono text-[11px] font-medium tracking-wide text-ink50/90">Join</span>
              <div className="h-px flex-1 bg-gradient-to-l from-transparent to-line" />
            </div>

            <div className="flex gap-2">
              <Input
                icon={<Hash className="h-4 w-4" />}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="A1B2C3"
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
              <Button loading={busy === "join"} disabled={busy !== null} onClick={join}>
                Join
              </Button>
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 flex items-start gap-2 rounded-lg border border-warm/30 bg-warm/5 px-3 py-2.5 text-left text-sm text-warm"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </motion.p>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
