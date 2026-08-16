// Decorative hero background for the login screen: a stylized dark
// map with glowing "live route" lines and pulsing GPS markers. This
// isn't literal telemetry — nothing here is bound to real fleet data
// — it exists purely to make the entry point read as "live fleet
// tracking system" before the user is even signed in. Pure inline SVG
// + CSS animation, no map library instance idling behind a login form.
export function LoginMapBackground() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      {/* Ambient glow blobs */}
      <div className="login-glow login-glow-a" />
      <div className="login-glow login-glow-b" />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Static road network */}
        <g stroke="#2a2a42" strokeWidth="1.5" fill="none" opacity="0.55">
          <path d="M-20 120 L340 120 L520 260 L900 260 L1120 120" />
          <path d="M-20 340 L260 340 L420 480 L780 480 L960 620 L1220 620" />
          <path d="M120 -20 L120 220 L280 340" />
          <path d="M460 -20 L460 180 L620 300 L620 560 L460 700 L460 820" />
          <path d="M820 -20 L820 260" />
          <path d="M-20 560 L200 560 L340 480" />
          <path d="M960 620 L1000 780" />
          <path d="M700 480 L700 800" />
          <path d="M1040 260 L1220 340" />
        </g>

        {/* Live glowing routes, traced over a subset of the roads above */}
        <g fill="none" strokeLinecap="round">
          <path
            className="login-route login-route-1"
            d="M-20 120 L340 120 L520 260 L900 260 L1120 120"
            stroke="var(--indigo)"
          />
          <path
            className="login-route login-route-2"
            d="M460 -20 L460 180 L620 300 L620 560 L460 700 L460 820"
            stroke="var(--cyan)"
          />
          <path
            className="login-route login-route-3"
            d="M-20 340 L260 340 L420 480 L780 480 L960 620 L1220 620"
            stroke="var(--indigo)"
          />
        </g>

        {/* GPS pulse markers */}
        {[
          [340, 120],
          [900, 260],
          [620, 300],
          [460, 700],
          [780, 480],
          [960, 620],
        ].map(([cx, cy], i) => (
          <circle
            key={i}
            className="login-ping"
            style={{ animationDelay: `${i * 0.6}s` }}
            cx={cx}
            cy={cy}
            r="4"
            fill="var(--cyan)"
          />
        ))}
      </svg>

      {/* Vignette so the card stays readable regardless of what's behind it */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 600px 500px at 50% 50%, rgba(10,10,20,0.75) 0%, rgba(10,10,20,0.35) 45%, transparent 70%)",
        }}
      />
    </div>
  );
}
