import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Boxes,
  Braces,
  ChevronRight,
  Cpu,
  Globe2,
  HardDrive,
  Layers3,
  Loader2,
  Network,
  Search,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { chapters, findChapter, type Chapter } from "./curated";
import { LearningStudio } from "./learning-studio";
import { validateLessons } from "./lesson-validation";
import { GeneratedLesson, type GeneratedLessonData } from "./visual-engine/generic/GeneratedLesson";
import "./v2.css";

type SavedConcept = {
  slug: string;
  title: string;
  category: string;
  source: "curated" | "ai";
  status: "draft" | "published" | "archived";
  hit_count: number;
};

const engineLibrary = [
  { id: "protocol", label: "Protocols", description: "Packets, layers, endpoints, delivery and loss.", example: "tcp", lesson: "TCP transport", icon: Network },
  { id: "request", label: "Request pipelines", description: "Follow work across browsers, DNS, APIs and databases.", example: "web-request", lesson: "Web request", icon: Globe2 },
  { id: "memory", label: "Memory & data structures", description: "Inspect addresses, cells, buckets, nodes and pointers.", example: "arrays", lesson: "Arrays & memory", icon: HardDrive },
  { id: "tree", label: "Trees & graphs", description: "See hierarchy, connections, decisions and traversal paths.", example: "trees", lesson: "Binary search tree", icon: Waypoints },
  { id: "execution", label: "Execution & call stacks", description: "Step through instructions, calls, frames and returns.", example: "recursion", lesson: "Recursion", icon: Braces },
  { id: "concurrency", label: "Concurrency", description: "Compare threads, scheduling, shared work and timing.", example: "processes-threads", lesson: "Processes & threads", icon: Cpu },
  { id: "distributed", label: "Distributed systems", description: "Trace events across services, brokers and durable storage.", example: "message-queues", lesson: "Message queues", icon: Boxes },
  { id: "state-machine", label: "State machines", description: "Explore valid states, events, guards and transitions.", example: "state-machines", lesson: "Software lifecycles", icon: Layers3 },
] as const;

export default function KitabV2() {
  const lessonErrors = validateLessons(chapters);
  const [query, setQuery] = useState("");
  const [lesson, setLesson] = useState<Chapter | null>(null);
  const [generated, setGenerated] = useState<GeneratedLessonData | null>(null);
  const [saved, setSaved] = useState<SavedConcept[]>([]);
  const [loading, setLoading] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [error, setError] = useState("");

  const results = useMemo(
    () => chapters.filter((chapter) => `${chapter.title} ${chapter.family} ${chapter.summary}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  );
  const savedResults = useMemo(
    () => saved.filter((item) => !chapters.some((chapter) => chapter.slug === item.slug)),
    [saved],
  );

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) {
      setSaved([]);
      setLibraryLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLibraryLoading(true);
      try {
        const response = await fetch(`/api/concepts?q=${encodeURIComponent(clean)}`, { signal: controller.signal });
        const data = (await response.json()) as { concepts?: SavedConcept[] };
        if (response.ok) setSaved(data.concepts ?? []);
      } catch (searchError) {
        if (!(searchError instanceof DOMException && searchError.name === "AbortError")) setSaved([]);
      } finally {
        if (!controller.signal.aborted) setLibraryLoading(false);
      }
    }, 280);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  async function open(name: string) {
    const clean = name.trim();
    if (!clean || loading) return;
    const local = findChapter(clean);
    if (local?.slug === "tcp") {
      window.location.href = "/lesson/tcp";
      return;
    }
    if (local) {
      setGenerated(null);
      setLesson(local);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/concept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ concept: clean }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The lesson could not be created.");
      setLesson(null);
      setGenerated(data);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "The lesson could not be created.");
    } finally {
      setLoading(false);
    }
  }

  if (lessonErrors.length) {
    return <main className="v2-fatal"><h1>Kitab could not open this build.</h1><p>The lesson library contains invalid scene data.</p></main>;
  }
  if (lesson) return <LearningStudio key={lesson.slug} chapter={lesson} close={() => setLesson(null)} />;
  if (generated) return <GeneratedLesson data={generated} close={() => setGenerated(null)} />;

  return (
    <div className="v2-home">
      <header className="v2-nav">
        <a href="#top" className="v2-brand"><span><BookOpen /></span><b>Kitab<small lang="ar">كتاب</small></b></a>
        <nav><a href="#engines">Systems</a><a href="#library">Library</a><a href="#method">How you learn</a></nav>
      </header>
      <main id="top">
        <section className="v2-hero">
          <div>
            <p className="eyebrow">AN INTERACTIVE BOOK OF COMPUTER SCIENCE</p>
            <h1>Don’t memorize it.<br /><em>Run it.</em></h1>
            <p className="lead">Open a concept, predict what happens, change the system and explain it back. Kitab turns difficult mechanisms into guided labs.</p>
            <form onSubmit={(event) => { event.preventDefault(); void open(query); }}>
              <Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What do you want to understand?" aria-label="Search a concept" />
              <button disabled={loading}>{loading ? <Loader2 className="spin" /> : <ChevronRight />}<span>{loading ? "Building lesson" : "Open lesson"}</span></button>
            </form>
            {error && <p className="v2-error">{error}</p>}
            <div className="quick">Try:{["TCP", "Linked lists", "Recursion", "Database indexes"].map((item) => <button onClick={() => void open(item)} key={item}>{item}</button>)}</div>
          </div>
          <div className="book-map" aria-hidden="true">
            <div className="book-core"><BookOpen /><b>Kitab</b><small>learn by doing</small></div>
            {["Predict", "Run", "Change", "Explain"].map((item, index) => <span className={`book-step s${index + 1}`} key={item}><i>{index + 1}</i>{item}</span>)}
          </div>
        </section>

        <section id="method" className="method">
          <article><b>01</b><h2>Predict</h2><p>Commit to what you think will happen before seeing the answer.</p></article>
          <article><b>02</b><h2>Run</h2><p>Move through one synchronized visual scene at a time.</p></article>
          <article><b>03</b><h2>Change</h2><p>Introduce loss, collisions, delays or different inputs.</p></article>
          <article><b>04</b><h2>Explain</h2><p>Complete the scene by describing which state changed and why.</p></article>
        </section>

        <section id="engines" className="engine-browser">
          <header>
            <div><p className="eyebrow">EXPLORE BY SYSTEM</p><h2>Eight ways to see how software works</h2></div>
            <p>Each system has its own visual language. Open any example to see the matching interactive engine.</p>
          </header>
          <div>
            {engineLibrary.map((item, index) => {
              const Icon = item.icon;
              return (
                <button type="button" data-engine={item.id} onClick={() => void open(item.example)} key={item.id}>
                  <span className="engine-number">{String(index + 1).padStart(2, "0")}</span>
                  <Icon aria-hidden="true" />
                  <h3>{item.label}</h3>
                  <p>{item.description}</p>
                  <footer><span>Example: {item.lesson}</span><ChevronRight aria-hidden="true" /></footer>
                </button>
              );
            })}
          </div>
        </section>

        <section id="library" className="v2-library">
          <div className="library-copy"><p className="eyebrow">GUIDED LABS</p><h2>Explore a mechanism</h2><p>Reviewed lessons use purpose-built simulations. New searches are generated as drafts and saved for the next learner.</p></div>
          <label className="library-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reviewed and saved lessons" aria-label="Filter lessons" />{libraryLoading && <Loader2 className="spin" />}</label>

          {results.length > 0 && <div className="course-grid">
            {results.map((chapter, index) => <button onClick={() => void open(chapter.slug)} key={chapter.slug}><span>{String(index + 1).padStart(2, "0")}</span><small>{chapter.family}</small><h3>{chapter.title}</h3><p>{chapter.summary}</p><footer><b>{chapter.slug === "tcp" ? "Reference system" : `${chapter.steps.length} scenes · specialized engine`}</b><ChevronRight /></footer></button>)}
          </div>}

          {savedResults.length > 0 && <section className="saved-lessons">
            <header><div><span>SAVED IN KITAB</span><h3>Generated lessons matching “{query}”</h3></div><small>{savedResults.length} result{savedResults.length === 1 ? "" : "s"}</small></header>
            <div>{savedResults.map((item) => <button onClick={() => void open(item.slug)} key={item.slug}><Sparkles /><span><small>{item.category} · GENERATED DRAFT</small><b>{item.title}</b><em>Opened {item.hit_count} time{item.hit_count === 1 ? "" : "s"}</em></span><ChevronRight /></button>)}</div>
          </section>}

          {!results.length && !savedResults.length && query && !libraryLoading && <div className="empty"><Sparkles /><h3>No saved lesson yet</h3><p>Kitab will generate the explanation, select the correct visual engine and save the resulting draft.</p><button onClick={() => void open(query)}>Create “{query}”</button></div>}
        </section>
      </main>
      <footer className="v2-footer"><div className="v2-brand"><span><BookOpen /></span><b>Kitab<small lang="ar">كتاب</small></b></div><p>Understand the mechanism, not just the definition.</p></footer>
    </div>
  );
}
