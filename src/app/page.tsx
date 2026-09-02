"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function getApiUrl() {
  // Use Next.js proxy rewrite configured in next.config.ts
  return "/api";
}

/* ─────────────────────────────────────────────────────────────
   Linkify: auto-detect URLs and phone numbers in plain text
───────────────────────────────────────────────────────────── */
const URL_REGEX = /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
const PHONE_REGEX = /(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){3,6}\d{2,4}/g;

function linkifyText(text: string): React.ReactNode[] {
  // Combine URL and phone patterns, keeping track of which matched
  const combined = /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+|(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){3,6}\d{2,4}/gi;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = combined.exec(text)) !== null) {
    const matchStr = match[0];
    // Only treat as phone if it has digits >= 7 and no slashes
    const isUrl = /^https?:\/\//.test(matchStr);
    const isPhone = !isUrl && /\d{7,}/.test(matchStr.replace(/[^\d]/g, ''));
    if (!isUrl && !isPhone) continue;
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (isUrl) {
      nodes.push(
        <a key={key++} href={matchStr} target="_blank" rel="noopener noreferrer"
           className="text-blue-600 underline hover:text-blue-800 break-all">
          {matchStr}
        </a>
      );
    } else {
      const digits = matchStr.replace(/[^\d+]/g, '');
      nodes.push(
        <a key={key++} href={`tel:${digits}`}
           className="text-blue-600 underline hover:text-blue-800 whitespace-nowrap">
          {matchStr}
        </a>
      );
    }
    lastIndex = match.index + matchStr.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length ? nodes : [text];
}

/* Custom ReactMarkdown components with linkify */
const markdownComponents = {
  // Existing markdown links — open in new tab
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (!href) return <span>{children}</span>;
    const isPhone = href.startsWith('tel:');
    return (
      <a href={href}
         target={isPhone ? undefined : '_blank'}
         rel={isPhone ? undefined : 'noopener noreferrer'}
         className="text-blue-600 underline hover:text-blue-800">
        {children}
      </a>
    );
  },
  // Plain text nodes — run linkify on them
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 last:mb-0">
      {React.Children.map(children, (child) =>
        typeof child === 'string' ? linkifyText(child) : child
      )}
    </p>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li>
      {React.Children.map(children, (child) =>
        typeof child === 'string' ? linkifyText(child) : child
      )}
    </li>
  ),
};

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
interface Source {
  content: string;
  metadata: { original_title: string; source: string };
}

interface Message {
  query: string;
  answer: string;
  sources: Source[];
  followup: string[];
  done: boolean;
}

/* ─────────────────────────────────────────────────────────────
   Component
───────────────────────────────────────────────────────────── */
export default function Home() {
  const apiUrl = getApiUrl();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "requesting" | "granted" | "denied">("idle");
  const bottomRef = useRef<HTMLDivElement>(null);

  /* ── Typewriter placeholder ── */
  const exampleQueries = [
    "What is the price of the Margherita pizza?",
    "Do you have any chicken pizzas?",
    "Show me vegetarian pizzas under ₹700",
    "What comes in the Sakkath Veg Combo?",
  ];
  const [placeholder, setPlaceholder] = useState("");
  const [exampleIndex, setExampleIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const current = exampleQueries[exampleIndex];
    const speed = isDeleting ? 35 : 65;
    const timer = setTimeout(() => {
      if (!isDeleting) {
        if (charIndex < current.length) {
          setPlaceholder("Ex: " + current.substring(0, charIndex + 1));
          setCharIndex((p) => p + 1);
        } else {
          setTimeout(() => setIsDeleting(true), 2800);
        }
      } else {
        if (charIndex > 0) {
          setPlaceholder("Ex: " + current.substring(0, charIndex - 1));
          setCharIndex((p) => p - 1);
        } else {
          setIsDeleting(false);
          setExampleIndex((p) => (p + 1) % exampleQueries.length);
        }
      }
    }, speed);
    return () => clearTimeout(timer);
  }, [charIndex, isDeleting, exampleIndex]);

  /* ── Fetch suggestions (on mount, no context) ── */
  useEffect(() => {
    fetchSuggestions(null);
  }, []);

  /* ── Auto-scroll to bottom on new content ── */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  /* ── Geolocation helpers ── */
  const LOCATION_KEYWORDS = [
    "near me", "nearby", "nearest", "closest", "around me", "my location",
    "près de moi", "proche de moi", "autour de moi", "le plus proche",
    "perto de mim", "perto", "localização",
  ];

  const isLocationQuery = (q: string) =>
    LOCATION_KEYWORDS.some((kw) => q.toLowerCase().includes(kw));

  const requestGeolocation = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      setLocationStatus("requesting");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(loc);
          setLocationStatus("granted");
          resolve(loc);
        },
        () => {
          setLocationStatus("denied");
          resolve(null);
        },
        { timeout: 6000, maximumAge: 60000 }
      );
    });

  /* ─────────────────────────────────────────────────────────
     Fetch suggestions helper
  ───────────────────────────────────────────────────────── */
  const fetchSuggestions = async (contextQuery: string | null) => {
    setSuggestionsLoading(true);
    try {
      const url = contextQuery
        ? `${apiUrl}/suggestions?context=${encodeURIComponent(contextQuery)}`
        : `${apiUrl}/suggestions`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      }
    } catch (err) {
      console.error("Failed to fetch suggestions:", err);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  /* ─────────────────────────────────────────────────────────
     Search handler
  ───────────────────────────────────────────────────────── */
  const handleSearch = async (e?: React.FormEvent, forcedQuery?: string) => {
    if (e) e.preventDefault();
    const activeQuery = (forcedQuery || query).trim();
    if (!activeQuery || loading) return;

    setLoading(true);
    setQuery("");

    // If query mentions location keywords, request geolocation first
    let location: { lat: number; lng: number } | null = userLocation;
    if (isLocationQuery(activeQuery) && !userLocation) {
      location = await requestGeolocation();
    }

    // Append the new message (empty answer while streaming)
    setMessages((prev) => [
      ...prev,
      { query: activeQuery, answer: "", sources: [], followup: [], done: false },
    ]);

    try {
      const res = await fetch(`${apiUrl}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: activeQuery,
          location,
          history: messages.map((m) => ({ query: m.query, answer: m.answer }))
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No readable stream.");

      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);

            if (data.type === "sources") {
              setMessages((prev) => {
                if (prev.length === 0) return prev;
                const next = [...prev];
                const last = next[next.length - 1];
                if (!last) return prev;
                next[next.length - 1] = { ...last, sources: data.sources };
                return next;
              });
            } else if (data.type === "token") {
              setMessages((prev) => {
                if (prev.length === 0) return prev;
                const next = [...prev];
                const last = next[next.length - 1];
                if (!last) return prev;
                // Strip any [FOLLOWUPS] marker and everything after it
                const raw = (last.answer + data.token).split("[FOLLOWUPS]")[0].replace(/\[FOLLOWUPS\]/g, "");
                next[next.length - 1] = { ...last, answer: raw };
                return next;
              });
            } else if (data.type === "followup") {
              // Strip "Question N:" / "Question N." prefixes the model sometimes adds
              const cleanFollowup = (data.followup as string[]).map((q: string) =>
                q.replace(/^question\s*\d+[:.\-]\s*/i, "").trim()
              ).filter((q: string) => q.length > 3);
              setMessages((prev) => {
                if (prev.length === 0) return prev;
                const next = [...prev];
                const last = next[next.length - 1];
                if (!last) return prev;
                next[next.length - 1] = {
                  ...last,
                  followup: cleanFollowup,
                };
                return next;
              });
            } else if (data.type === "done") {
              setMessages((prev) => {
                if (prev.length === 0) return prev;
                const next = [...prev];
                const last = next[next.length - 1];
                if (!last) return prev;
                next[next.length - 1] = { ...last, done: true };
                return next;
              });
            }
          } catch {
            /* skip malformed line */
          }
        }
      }
    } catch (err: any) {
      console.error("Search error:", err);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
      // Refresh suggestions based on the last query (async, non-blocking)
      fetchSuggestions(activeQuery);
    }
  };

  const resetSearch = () => {
    setMessages([]);
    setQuery("");
    fetchSuggestions(null);
  };



  /* ─────────────────────────────────────────────────────────
     Render
  ───────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col font-sans text-slate-800">
      {/* ── Sticky Header ── */}
      <nav className="bg-white/90 backdrop-blur-md sticky top-0 z-50 py-4 px-8 border-b border-slate-100">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src="https://dynl.mktgcdn.com/p/u6nDp-S6NPMwZge55Pl2YCzrx-q8ZWc9XUAMdM_AcSc/500x500" alt="Papa Johns" className="h-10 w-auto" />
            <span className="text-[10px] tracking-widest uppercase font-bold text-[#00684A] mt-1">
              RAG SEARCH AI
            </span>
          </div>
          
          <div className="flex items-center gap-8">
            <div className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-600">
              <a href="#" className="hover:text-slate-900 transition-colors">Menu</a>
              <a href="#" className="hover:text-slate-900 transition-colors">Specials</a>
              <a href="#" className="hover:text-slate-900 transition-colors">Locations</a>
              {messages.length > 0 && (
                <button
                  onClick={resetSearch}
                  className="hover:text-[#00684A] transition-colors font-bold"
                >
                  New Search
                </button>
              )}
            </div>
            <button className="bg-[#00684A] hover:bg-[#00523b] text-white text-xs font-bold px-6 py-2.5 rounded-full transition-colors cursor-pointer">
              Sign In
            </button>
          </div>
        </div>
      </nav>

      {/* ── Main ── */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 md:px-8 pb-32">
        {/* Welcome screen */}
        {messages.length === 0 && !loading && (
          <section className="py-24 flex flex-col items-center text-center">
              <img src="https://dynl.mktgcdn.com/p/u6nDp-S6NPMwZge55Pl2YCzrx-q8ZWc9XUAMdM_AcSc/500x500" alt="Papa Johns" className="h-16 md:h-20 w-auto object-contain mx-auto drop-shadow-sm" />
            <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-4">
              Papa Johns AI Assistant
            </h1>
            <p className="text-sm text-slate-500 max-w-md mb-12 leading-relaxed">
              Ask anything about our delicious Pizzas, Combos, Sides, and more.
            </p>

            {/* Search form */}
            <form onSubmit={handleSearch} className="w-full max-w-2xl mb-10 relative">
              <div className="flex items-center bg-white rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-2 transition-all duration-200 hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100">
                <div className="pl-5 text-slate-300">
                  <span className="animate-pulse font-bold text-lg">|</span>
                </div>
                <input
                  id="main-search-input"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={placeholder || "Type your query..."}
                  className="flex-1 px-4 py-4 outline-none text-base text-slate-800 placeholder-slate-400 bg-transparent"
                />
                <button
                  type="submit"
                  disabled={!query.trim()}
                  className="bg-[#00684A] disabled:bg-slate-200 hover:bg-[#00523b] text-white w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer shrink-0"
                >
                  <svg className="w-5 h-5 -ml-1 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              </div>
              {/* Location status badge below main search form */}
              {locationStatus === "requesting" && (
                <p className="mt-2.5 text-xs text-blue-500 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  Requesting location…
                </p>
              )}
              {locationStatus === "granted" && userLocation && (
                <p className="mt-2.5 text-xs text-emerald-600 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                  Location detected ({userLocation.lat.toFixed(3)}, {userLocation.lng.toFixed(3)})
                </p>
              )}
              {locationStatus === "denied" && (
                <p className="mt-2.5 text-xs text-amber-500 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  Location access denied — results not personalized
                </p>
              )}
            </form>

            {/* Suggestions */}
            {suggestionsLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce [animation-delay:0.3s]" />
                <span className="ml-1">Generating suggestions…</span>
              </div>
            ) : suggestions.length > 0 ? (
              <div className="w-full max-w-2xl">
                <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-3">
                  Suggested searches
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {suggestions.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSearch(undefined, q)}
                      className="px-4 py-3.5 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-xl text-left text-xs font-medium text-slate-700 hover:text-slate-900 transition-all duration-200 shadow-sm flex items-start gap-2.5 cursor-pointer group"
                    >
                      <span className="mt-0.5 w-4 h-4 rounded-md bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center text-blue-500 shrink-0 transition-all">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </span>
                      <span className="leading-snug">{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        )}

        {/* ── Chat feed ── */}
        <div className="space-y-8 pt-6">
          {messages.map((msg, idx) => (
            <div key={idx} id={`message-${idx}`} className="space-y-4">
              {/* User bubble */}
              <div className="flex justify-end">
                <div className="bg-slate-800 text-white px-5 py-3 rounded-2xl rounded-tr-sm shadow-sm max-w-[78%]">
                  <p className="text-sm font-medium leading-relaxed">{msg.query}</p>
                </div>
              </div>

              {/* Assistant card */}
              <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
                {/* Card header */}
                <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-100 bg-slate-50/60">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
                    <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Papa Johns Assistant</span>
                  </div>

                </div>

                {/* Answer body */}
                <div className="px-6 py-5">
                  {msg.answer ? (
                    msg.done ? (
                      /* Streaming finished — render full markdown */
                      <div className="expert-answer prose prose-sm max-w-none text-slate-700">
                        <ReactMarkdown components={markdownComponents as never}>{msg.answer}</ReactMarkdown>
                      </div>
                    ) : (
                      /* Still streaming — use plain text to avoid ReactMarkdown DOM reconciliation errors */
                      <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                        {msg.answer}
                      </p>
                    )
                  ) : (
                    /* Loading dots — ONLY place loading shows */
                    <div className="flex items-center gap-1.5 py-3">
                      <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:0.15s]" />
                      <span className="w-2 h-2 bg-red-500 rounded-full animate-bounce [animation-delay:0.3s]" />
                      <span className="ml-2 text-xs text-slate-400">Generating…</span>
                    </div>
                  )}
                </div>

                {/* Sources */}
                {msg.sources.length > 0 && (
                  <div className="px-6 pb-4">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-2">Sources consulted</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {msg.sources
                        .filter((s, i, self) => i === self.findIndex((t) => t.content === s.content))
                        .slice(0, 4)
                        .map((s, si) => (
                          <div key={si} className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <p className="text-[10px] text-green-700 font-bold uppercase mb-1 truncate">
                              {s.metadata.original_title}
                            </p>
                            <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">
                              {s.content.slice(0, 120)}…
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Follow-up suggestions */}
                {msg.followup && msg.followup.length > 0 && (
                  <div className="px-6 pb-5 flex flex-wrap gap-2">
                    {msg.followup.map((fQ, fIdx) => (
                      <button
                        key={fIdx}
                        disabled={loading}
                        onClick={() => handleSearch(undefined, fQ)}
                        className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-100 hover:border-blue-200 rounded-xl text-xs font-semibold text-blue-600 hover:text-blue-700 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {fQ}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Follow-ups live inside each message card — no duplicate panel here */}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* ── Floating bottom input (shown only when conversation is active) ── */}
      {messages.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC]/95 to-transparent px-4 pt-4 pb-5">
          {/* Location badge in bottom bar */}
          {locationStatus === "granted" && userLocation && (
            <div className="max-w-3xl mx-auto mb-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-600 font-semibold bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                Location active · {userLocation.lat.toFixed(3)}, {userLocation.lng.toFixed(3)}
              </span>
            </div>
          )}
          {locationStatus === "requesting" && (
            <div className="max-w-3xl mx-auto mb-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-red-600 font-semibold bg-red-50 border border-red-200 rounded-full px-2.5 py-1">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                Requesting location…
              </span>
            </div>
          )}
          <form onSubmit={handleSearch} className="max-w-3xl mx-auto">
            <div className="flex items-center bg-white rounded-2xl border border-slate-200 shadow-md p-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
              <input
                id="bottom-search-input"
                type="text"
                disabled={loading}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={loading ? "Generating…" : placeholder}
                className="flex-1 px-4 py-2.5 outline-none text-sm text-slate-800 placeholder-slate-400 bg-transparent disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="bg-green-700 disabled:bg-slate-200 text-white w-10 h-10 rounded-xl flex items-center justify-center hover:bg-green-800 transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
