import { useCallback, useEffect, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import PageMenu from "./PageMenu";
import "./AnalyticsPage.css";

type DataPoint = { label: string; value: number };
type Metric = {
  name: string;
  type: "bar" | "pie" | "table";
  data: DataPoint[];
};
type Payload = { metrics: Metric[]; generated_at: string };

const palette = ["#9a5962", "#d0a07e", "#6f8790", "#b8a05f", "#776586", "#7c9279", "#c77e60", "#547167"];
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

async function responseError(response: Response): Promise<string> {
  if (response.headers.get("content-type")?.includes("application/json")) {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  }
  return `Could not load analytics (HTTP ${response.status}).`;
}

function isDataPoint(value: unknown): value is DataPoint {
  return value !== null && typeof value === "object" &&
    "label" in value && typeof value.label === "string" &&
    "value" in value && typeof value.value === "number" && Number.isFinite(value.value);
}

function isMetric(value: unknown): value is Metric {
  return value !== null && typeof value === "object" &&
    "name" in value && typeof value.name === "string" &&
    "type" in value && (value.type === "bar" || value.type === "pie" || value.type === "table") &&
    "data" in value && Array.isArray(value.data) && value.data.every(isDataPoint);
}

function isPayload(value: unknown): value is Payload {
  if (
    !value ||
    typeof value !== "object" ||
    !("metrics" in value) ||
    !Array.isArray(value.metrics) ||
    !("generated_at" in value) ||
    typeof value.generated_at !== "string"
  ) return false;
  return value.metrics.every(isMetric);
}

export default function AnalyticsPage() {
  const { getAccessTokenSilently, isAuthenticated, isLoading: isAuthLoading, loginWithRedirect } = useAuth0();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError("");
    try {
      if (!audience) throw new Error("Auth0 API audience is not configured.");
      const token = await getAccessTokenSilently({ authorizationParams: { audience } });
      if (!token) throw new Error("Auth0 did not return an access token.");
      const response = await fetch("/api/analytics/wardrobe", {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const data: unknown = await response.json();
      if (!isPayload(data)) throw new Error("The analytics API returned an invalid response.");
      setPayload(data);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Could not load analytics.");
    } finally {
      setIsLoading(false);
    }
  }, [getAccessTokenSilently]);

  useEffect(() => {
    document.title = "Wardrobe Analytics | Passionista";
    if (!isAuthenticated || isAuthLoading) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isAuthenticated, isAuthLoading, load]);

  return (
    <div className="analytics-page">
      <header className="stylist-header">
        <a className="stylist-wordmark" href="/">passionista<span>.</span></a>
        <span className="stylist-header-title">STYLE INSIGHTS</span>
        <PageMenu current="analytics" />
      </header>
      <main className="analytics-content">
        <div className="analytics-heading">
          <div>
            <p className="analytics-eyebrow">STYLE INSIGHTS</p>
            <h1>Community wardrobe insights</h1>
            <p>Aggregated statistics from tagged items across the community.</p>
          </div>
          {isAuthenticated && (
            <button className="analytics-refresh" type="button" disabled={isLoading} onClick={() => void load()}>
              {isLoading ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>

        {isAuthLoading ? (
          <p className="analytics-status" role="status">Checking your sign-in…</p>
        ) : !isAuthenticated ? (
          <section className="analytics-message">
            <p>Sign in to view community wardrobe insights.</p>
            <button
              className="analytics-refresh"
              type="button"
              onClick={() => void loginWithRedirect({ appState: { returnTo: "/analytics" } })}
            >
              Sign in
            </button>
          </section>
        ) : error ? (
          <p className="analytics-error" role="alert">{error}</p>
        ) : isLoading && !payload ? (
          <p className="analytics-status" role="status">Loading wardrobe analytics…</p>
        ) : payload ? (
          <>
            <section className="analytics-grid" aria-label="Wardrobe analytics">
              {payload.metrics.map((metric) => (
                <article className={`analytics-card analytics-card-${metric.type}`} key={metric.name}>
                  <div className="analytics-card-heading">
                    <div><p>COMMUNITY-WIDE AGGREGATE</p><h2>{metric.name}</h2></div>
                    <span>{metric.data.length} groups</span>
                  </div>
                  {metric.type === "bar" && <BarChart data={metric.data} />}
                  {metric.type === "pie" && <PieChart data={metric.data} />}
                  {metric.type === "table" && <StylesBreakdown data={metric.data} />}
                </article>
              ))}
            </section>
            <p className="analytics-generated">Updated {new Date(payload.generated_at).toLocaleString()}</p>
          </>
        ) : null}
      </main>
      <footer className="site-footer">
        <span>PASSIONISTA</span>
        <span>YOUR STYLE, YOUR STORY</span>
      </footer>
    </div>
  );
}

function BarChart({ data }: { data: DataPoint[] }) {
  if (!data.length) return <p className="analytics-empty">No tagged wardrobe data yet.</p>;
  const maximum = Math.max(...data.map((point) => point.value), 1);
  return (
    <div className="analytics-bars">
      {data.map((point, index) => (
        <div className="analytics-bar-row" key={point.label}>
          <span title={point.label}>{point.label}</span>
          <div className="analytics-bar-track">
            <span
              style={{
                width: `${Math.max(point.value > 0 ? 2 : 0, point.value / maximum * 100)}%`,
                backgroundColor: palette[index % palette.length],
              }}
            />
          </div>
          <strong>{point.value.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}

function PieChart({ data }: { data: DataPoint[] }) {
  const total = data.reduce((sum, point) => sum + point.value, 0);
  let accumulated = 0;
  const gradient = total
    ? data.map((point, index) => {
        const start = accumulated / total * 360;
        accumulated += point.value;
        return `${palette[index % palette.length]} ${start}deg ${accumulated / total * 360}deg`;
      }).join(", ")
    : "#e9e3de 0deg 360deg";
  return (
    <div className="analytics-pie-layout">
      <div className="analytics-donut" style={{ background: `conic-gradient(${gradient})` }}>
        <div><strong>{total.toLocaleString()}</strong><span>items</span></div>
      </div>
      <ul className="analytics-legend">
        {data.length ? data.map((point, index) => (
          <li key={point.label}>
            <span style={{ backgroundColor: palette[index % palette.length] }} />
            <span>{point.label}</span><strong>{point.value.toLocaleString()}</strong>
          </li>
        )) : <li className="analytics-empty">No tagged wardrobe data yet.</li>}
      </ul>
    </div>
  );
}

function StylesBreakdown({ data }: { data: DataPoint[] }) {
  const [hoveredStyle, setHoveredStyle] = useState<DataPoint | null>(null);
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const circumference = 2 * Math.PI * 76;
  const segments = data.map((point, index) => ({
    point,
    offset: data.slice(0, index).reduce((sum, previous) => sum + previous.value / total * circumference, 0),
  }));

  if (!data.length) return <p className="analytics-empty">No style tags found yet.</p>;

  return (
    <div className="analytics-styles-layout">
      <div className="analytics-styles-chart">
        <div className="analytics-styles-donut">
          <svg
            viewBox="0 0 180 180"
            role="img"
            aria-label={`Style tag distribution across ${total.toLocaleString()} tagged pieces`}
          >
            <circle className="analytics-styles-track" cx="90" cy="90" r="76" />
            {segments.map(({ point, offset }, index) => {
              const segmentLength = point.value / total * circumference;
              const percentage = total ? Math.round(point.value / total * 100) : 0;
              const label = `${point.label}: ${point.value.toLocaleString()} pieces (${percentage}%)`;
              return (
                <circle
                  key={point.label}
                  className="analytics-styles-segment"
                  cx="90"
                  cy="90"
                  r="76"
                  stroke={palette[index % palette.length]}
                  strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
                  strokeDashoffset={-offset}
                  aria-label={label}
                  role="img"
                  tabIndex={0}
                  onMouseEnter={() => setHoveredStyle(point)}
                  onMouseLeave={() => setHoveredStyle(null)}
                  onFocus={() => setHoveredStyle(point)}
                  onBlur={() => setHoveredStyle(null)}
                >
                  <title>{label}</title>
                </circle>
              );
            })}
          </svg>
          <div className="analytics-styles-donut-center">
            <strong>{total.toLocaleString()}</strong><span>style tags</span>
          </div>
        </div>
        <p className="analytics-style-hover" aria-live="polite">
          {hoveredStyle
            ? <><strong>{hoveredStyle.label}</strong><span>{hoveredStyle.value.toLocaleString()} pieces · {total ? Math.round(hoveredStyle.value / total * 100) : 0}%</span></>
            : <span>Hover or focus a slice to see its style.</span>}
        </p>
      </div>
      <div className="analytics-table-wrap" tabIndex={0} aria-label="Scrollable list of common styles">
        <table className="analytics-table">
          <thead><tr><th>Style</th><th>Pieces</th></tr></thead>
          <tbody>
            {data.map((point, index) => (
              <tr key={point.label}>
                <td><span className="analytics-style-swatch" style={{ backgroundColor: palette[index % palette.length] }} />{point.label}</td>
                <td>{point.value.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
