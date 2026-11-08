import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import "./StylistPage.css";

const questions = [
  {
    id: "identify",
    number: "01",
    title: "What am I looking at?",
  },
  {
    id: "my-style",
    number: "02",
    title: "Does it fit my style?",
  },
  {
    id: "wardrobe-match",
    number: "03",
    title: "What in my wardrobe goes with it?",
  },
  {
    id: "outfit-ideas",
    number: "04",
    title: "How could I wear it?",
  },
] as const;

type QuestionId = (typeof questions)[number]["id"];
type StylistResult = {
  answer: string;
  matches?: { name: string; reason?: string }[];
};
type ResultState = "idle" | "loading" | "ready" | "unavailable" | "error";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const stylistApiUrl = import.meta.env.VITE_STYLIST_API_URL as string | undefined;

export default function StylistPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedQuestionId, setSelectedQuestionId] = useState<QuestionId>("identify");
  const [result, setResult] = useState<StylistResult | null>(null);
  const [resultState, setResultState] = useState<ResultState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const previewUrlRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Stylist Studio | Passionista";
    return () => {
      document.title = previousTitle;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      requestRef.current?.abort();
    };
  }, []);

  const selectedQuestion = questions.find((question) => question.id === selectedQuestionId)!;

  function clearAnalysis() {
    requestRef.current?.abort();
    setResult(null);
    setResultState("idle");
    setErrorMessage("");
  }

  function chooseFile(nextFile?: File) {
    if (!nextFile) return;
    clearAnalysis();
    if (!ACCEPTED_IMAGE_TYPES.includes(nextFile.type)) {
      setErrorMessage("Choose a JPG or PNG image.");
      return;
    }
    if (nextFile.size > MAX_IMAGE_SIZE) {
      setErrorMessage("Choose an image smaller than 10 MB.");
      return;
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextUrl = URL.createObjectURL(nextFile);
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
    setFile(nextFile);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  function removeFile() {
    clearAnalysis();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setFile(null);
  }

  async function askStylist() {
    if (!file) return;
    clearAnalysis();

    if (!stylistApiUrl) {
      setResultState("unavailable");
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setResultState("loading");

    const body = new FormData();
    body.append("image", file);
    body.append("questionID", selectedQuestion.id);
    body.append("question", selectedQuestion.title);

    try {
      const response = await fetch(stylistApiUrl, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("The stylist could not answer right now. Please try again.");
      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== "object" ||
        !("answer" in data) ||
        typeof data.answer !== "string"
      ) {
        throw new Error("The stylist returned an unexpected response.");
      }
      const matches = "matches" in data && Array.isArray(data.matches)
        ? data.matches.filter(
            (match): match is { name: string; reason?: string } =>
              match !== null &&
              typeof match === "object" &&
              "name" in match &&
              typeof match.name === "string" &&
              (!("reason" in match) || typeof match.reason === "string"),
          )
        : undefined;
      setResult({ answer: data.answer, matches });
      setResultState("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setResultState("error");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  return (
    <div className="stylist-page">
      <header className="stylist-header">
        <a className="stylist-wordmark" href="/" aria-label="Passionista home">
          passionista<span>.</span>
        </a>
        <span className="stylist-header-title">THE STYLIST STUDIO</span>
        <a className="stylist-home-link" href="/">Back to home <span aria-hidden="true"></span></a>
      </header>

      <main className="stylist-main">
        <section className="stylist-intro" aria-labelledby="stylist-title">
          <div>
            <p className="stylist-eyebrow"><span /> YOUR STYLE, IN THE MOMENT</p>
            <h1 id="stylist-title">Meet your <em>stylist.</em></h1>
          </div>
        </section>

        <div className="stylist-workspace">
          <section className="stylist-panel upload-panel" aria-labelledby="upload-title">
            <div className="panel-heading">
              <span className="step-number">01</span>
              <div><h2 id="upload-title">Add a photo</h2></div>
            </div>
            <p className="panel-description">Upload a photo of the piece you found.</p>

            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png"
              aria-label="Upload a clothing photo"
              onChange={handleInputChange}
            />

            {previewUrl ? (
              <div className="photo-preview">
                <img src={previewUrl} alt="The clothing item you uploaded" />
                <div className="photo-overlay">
                  <span className="photo-name" title={file?.name}>{file?.name}</span>
                  <div className="photo-actions">
                    <button type="button" onClick={() => inputRef.current?.click()}>Replace</button>
                    <button type="button" onClick={removeFile}>Remove</button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className={isDragging ? "drop-zone is-dragging" : "drop-zone"}
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
                onDrop={handleDrop}
              >
                <div className="upload-icon" aria-hidden="true">↑</div>
                <h3>Drop your photo here</h3>
                <p>or browse your files to get started</p>
                <button className="upload-button" type="button" onClick={() => inputRef.current?.click()}>Choose a photo <span aria-hidden="true">↗</span></button>
                <span className="file-hint">JPG or PNG · UP TO 10 MB</span>
              </div>
            )}
            {errorMessage && resultState === "idle" && <p className="upload-error" role="alert">{errorMessage}</p>}
            <div className="upload-footnote"><span aria-hidden="true">✳</span> Your photo is only sent when you ask a question.</div>
          </section>

          <section className="stylist-panel questions-panel" aria-labelledby="questions-title">
            <div className="panel-heading">
              <span className="step-number">02</span>
              <div><h2 id="questions-title">Ask your stylist</h2></div>
            </div>
            <p className="panel-description">Helping you make decisions~</p>

            <div className="question-grid" role="group" aria-label="Stylist questions">
              {questions.map((question) => (
                <button
                  className={selectedQuestionId === question.id ? "question-card is-selected" : "question-card"}
                  key={question.id}
                  type="button"
                  aria-pressed={selectedQuestionId === question.id}
                  onClick={() => {
                    setSelectedQuestionId(question.id);
                    clearAnalysis();
                  }}
                >
                  <span className="question-number">{question.number}</span>
                  <span className="question-title">{question.title}</span>
                </button>
              ))}
            </div>

            <button className="ask-button" type="button" onClick={askStylist} disabled={!file || resultState === "loading"}>
              {resultState === "loading" ? "Thinking…" : "Ask about this piece"}
              <span aria-hidden="true">→</span>
            </button>

            <div className="answer-panel" aria-live="polite" aria-busy={resultState === "loading"}>
              <div className="answer-heading"><span className="answer-symbol" aria-hidden="true">✳</span><span>YOUR STYLIST SAYS</span></div>
              {resultState === "ready" && result ? (
                <>
                  <h3>{selectedQuestion.title}</h3>
                  <p>{result.answer}</p>
                  {result.matches && result.matches.length > 0 && (
                    <div className="wardrobe-matches">
                      <h4>From your wardrobe</h4>
                      <ul>{result.matches.map((match, index) => <li key={`${match.name}-${index}`}><strong>{match.name}</strong>{match.reason && <span>{match.reason}</span>}</li>)}</ul>
                    </div>
                  )}
                </>
              ) : resultState === "loading" ? (
                <p>Looking at your photo and putting together an answer…</p>
              ) : resultState === "unavailable" ? (
                <p>The AI stylist is not connected yet. Your photo has stayed in this browser.</p>
              ) : resultState === "error" ? (
                <p role="alert">{errorMessage}</p>
              ) : (
                <p>Your answer will appear here after you add a photo and ask a question.</p>
              )}
            </div>
          </section>
        </div>
      </main>
      <footer className="stylist-footer"><span>PASSIONISTA</span><span>YOUR STYLE, YOUR STORY</span></footer>
    </div>
  );
}
