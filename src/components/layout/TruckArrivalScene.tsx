import { Truck, Factory } from "lucide-react";

// Small looping illustration for the login welcome panel: a truck
// drives in along a dashed route, settles at the factory, holds,
// then fades out to reset. Purely decorative, not bound to real data.
export function TruckArrivalScene() {
  return (
    <div className="relative h-16 w-full overflow-hidden" aria-hidden>
      <div
        className="absolute left-0 right-6 top-1/2 -translate-y-1/2 border-t-2 border-dashed"
        style={{ borderColor: "var(--line)" }}
      />
      <div className="absolute right-0 top-1/2 -translate-y-1/2" style={{ color: "var(--indigo)" }}>
        <Factory size={22} strokeWidth={2.25} />
      </div>
      <div className="login-truck absolute top-1/2 -translate-y-1/2" style={{ color: "var(--cyan)" }}>
        <Truck size={26} strokeWidth={2.25} />
      </div>
    </div>
  );
}
