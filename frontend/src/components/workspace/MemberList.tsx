// Connected members as signal nodes; the active device is marked "you" (§7.2).
// Clicking another connected member aims your sends at just them (§5.3) —
// click again to go back to broadcast offers.
import { Crosshair } from "lucide-react";

import { useTransferStore } from "../../stores/transferStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

export function MemberList() {
  const members = useWorkspaceStore((s) => s.members);
  const me = useWorkspaceStore((s) => s.deviceId);
  const target = useTransferStore((s) => s.targetDeviceId);
  const setTarget = useTransferStore((s) => s.setTarget);

  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase tracking-widest text-muted">
        members · {members.filter((m) => m.is_connected).length} live
      </p>
      <ul className="flex flex-col gap-1.5">
        {members.map((m) => {
          const targetable = m.device_id !== me && m.is_connected;
          const targeted = target === m.device_id;
          return (
            <li key={m.device_id}>
              <button
                data-member={m.device_id}
                disabled={!targetable}
                onClick={() => setTarget(targeted ? null : m.device_id)}
                title={
                  targetable
                    ? targeted
                      ? "Sending only to this member — click to broadcast again"
                      : "Click to aim your sends at this member"
                    : undefined
                }
                className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left ${
                  targeted
                    ? "border-signal/60 bg-signal/10"
                    : "border-line bg-panel/40"
                } ${targetable ? "hover:border-signal/40" : "cursor-default"}`}
              >
                <span
                  className={`relative h-2 w-2 rounded-full ${
                    m.is_connected ? "bg-aura" : "bg-muted/40"
                  }`}
                >
                  {m.is_connected && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-aura/60" />
                  )}
                </span>
                <span className="flex-1 truncate text-sm">{m.display_name}</span>
                {targeted && <Crosshair className="h-3.5 w-3.5 text-signal" />}
                {m.device_id === me && (
                  <span className="font-mono text-[10px] text-aura">you</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {target && (
        <p className="mt-2 font-mono text-[11px] text-signal">
          aiming at {members.find((m) => m.device_id === target)?.display_name}
        </p>
      )}
    </div>
  );
}
