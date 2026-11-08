import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import PageMenu from "./PageMenu";
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
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE;

export default function StylistPage() {
  const {
    error: authError,
    getAccessTokenSilently,
    isAuthenticated,
    isLoading: isAuthLoading,
    loginWithRedirect,
  } = useAuth0();
  const [imageId, setImageId] = useState<string | null>(null);
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
    setImageId(null);


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
    setImageId(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setFile(null);
  }

  //grabs data and passes into backend route for gemini response.
  // posts using the question id. 
async function askStylist() {
  if (!file || !isAuthenticated || isAuthLoading) return;

  clearAnalysis();

  const controller = new AbortController();
  requestRef.current = controller;
  setResultState("loading");

  try {
    if (!auth0Audience) {
      throw new Error("Auth0 API audience is not configured.");
    }

    const accessToken = await getAccessTokenSilently({
      authorizationParams: { audience: auth0Audience },
    });
    let activeImageId = imageId;

    // 1. Upload the image if it hasn't been uploaded yet.
    if (!activeImageId) {
      const uploadBody = new FormData();
      uploadBody.append("image", file);

      const uploadResponse = await fetch("/api/images", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: uploadBody,
        signal: controller.signal,
      });

      if (!uploadResponse.ok) {
        throw new Error(await getApiError(uploadResponse, "Image upload failed"));
      }

      const uploadData = await uploadResponse.json();

      if (!uploadData.image_id) {
        throw new Error("The server did not return an image ID.");
      }

      activeImageId = uploadData.image_id;
      setImageId(activeImageId);
    }

    // 2. Ask the stylist about the uploaded image.
    const response = await fetch(`/api/images/${activeImageId}/ask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        questionID: selectedQuestion.id,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await getApiError(response, "The stylist could not answer right now"));
    }

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

    setErrorMessage(
      error instanceof Error
        ? error.message
        : "Something went wrong. Please try again."
    );

    setResultState("error");
  } finally {
    if (requestRef.current === controller) {
      requestRef.current = null;
    }
  }
}

async function getApiError(response: Response, fallback: string): Promise<string> {
  if (response.headers.get("content-type")?.includes("application/json")) {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
      return data.error;
    }
  }

  return `${fallback} (HTTP ${response.status})`;
}

    return (
        <div className="stylist-page">
    
        <header className="stylist-header">
            <a className="stylist-wordmark" href="/">
            passionista<span>.</span>
            </a>
            <span className="stylist-header-title">THE STYLIST STUDIO</span>
            <PageMenu current="stylist" />
        </header>
    
        <main className="stylist-main">
    
            <section className="stylist-intro" aria-labelledby="stylist-title">
            <div>
                <p className="stylist-eyebrow">
                <span /> YOUR STYLE, IN THE MOMENT
                </p>
                <h1 id="stylist-title">Meet your <em>stylist.</em></h1>
            </div>
            </section>
    
            <div className="stylist-workspace">
    
            <section className="stylist-panel upload-panel" aria-labelledby="upload-title">
                <div className="panel-heading">
                <span className="step-number">01</span>
                <div><h2 id="upload-title">Add a photo</h2></div>
                </div>
    
                <p className="panel-description">
                Upload a photo of the piece you found.
                </p>
    
                <input
                ref={inputRef}
                type="file"
                className="visually-hidden"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Upload a clothing photo"
                disabled={!isAuthenticated || isAuthLoading}
                onChange={handleInputChange}
                />
    
                {previewUrl ? (
                <div className="photo-preview">
                    <img src={previewUrl} alt="The clothing item you uploaded" />
    
                    <div className="photo-overlay">
                    <span className="photo-name" title={file?.name}>
                        {file?.name}
                    </span>
    
                    <div className="photo-actions">
                        <button type="button" onClick={() => inputRef.current?.click()}>
                        Replace
                        </button>
                        <button type="button" onClick={removeFile}>
                        Remove
                        </button>
                    </div>
                    </div>
                </div>
                ) : (
                <div
                    className={`drop-zone ${isDragging ? "is-dragging" : ""}`}
                    onDragEnter={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    }}
                    onDrop={(event) => {
                      if (isAuthenticated && !isAuthLoading) handleDrop(event);
                      else event.preventDefault();
                    }}
                >
                    <div className="upload-icon" aria-hidden="true">↑</div>
                    <h3>Drop your photo here</h3>
                    <p>or browse your files to get started</p>
    
                    <button
                    className="upload-button"
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={!isAuthenticated || isAuthLoading}
                    >
                    Choose a photo <span aria-hidden="true">↗</span>
                    </button>
    
                    <span className="file-hint">JPG or PNG · UP TO 10 MB</span>
                </div>
                )}
    
                {errorMessage && resultState === "idle" && (
                <p className="upload-error" role="alert">{errorMessage}</p>
                )}
            </section>
    
            <section className="stylist-panel questions-panel" aria-labelledby="questions-title">
                <div className="panel-heading">
                <span className="step-number">02</span>
                <div><h2 id="questions-title">Ask your stylist</h2></div>
                </div>
    
                <p className="panel-description">Helping you make decisions~</p>

                {isAuthLoading ? (
                  <p className="auth-notice" role="status">Checking your sign-in…</p>
                ) : !isAuthenticated ? (
                  <div className="auth-notice" role="alert">
                    <p>
                      {authError?.message ?? "Sign in before choosing a photo and asking the stylist."}
                    </p>
                    <button
                      className="ask-button"
                      type="button"
                      onClick={() => void loginWithRedirect({ appState: { returnTo: "/stylist" } })}
                    >
                      Sign in to continue <span aria-hidden="true">→</span>
                    </button>
                  </div>
                ) : authError ? (
                  <p className="upload-error" role="alert">{authError.message}</p>
                ) : null}
    
                <div className="question-grid" role="group" aria-label="Stylist questions">
                {questions.map((question) => (
                    <button
                    key={question.id}
                    type="button"
                    className={`question-card ${selectedQuestionId === question.id ? "is-selected" : ""}`}
                    aria-pressed={selectedQuestionId === question.id}
                    onClick={async () => {
                        setSelectedQuestionId(question.id);
                        clearAnalysis();
                    }}
                    >
                    <span className="question-number">{question.number}</span>
                    <span className="question-title">{question.title}</span>
                    </button>
                ))}
                </div>
    
                <button
                className="ask-button"
                type="button"
                onClick={askStylist}
                disabled={!file || !isAuthenticated || isAuthLoading || resultState === "loading"}
                >
                {resultState === "loading" ? "Thinking…" : "Ask about this piece"}
                <span aria-hidden="true">→</span>
                </button>
    
                <div
                className="answer-panel"
                aria-live="polite"
                aria-busy={resultState === "loading"}
                >
                <div className="answer-heading">
                    <span className="answer-symbol" aria-hidden="true">✳</span>
                    <span>YOUR STYLIST SAYS</span>
                </div>
    
                {resultState === "ready" && result ? (
                    <>
                    <h3>{selectedQuestion.title}</h3>
                    <p>{result.answer}</p>
    
                    {result.matches && result.matches.length > 0 && (
                        <div className="wardrobe-matches">
                        <h4>From your wardrobe</h4>
                        <ul>
                            {result.matches.map((match, index) => (
                            <li key={`${match.name}-${index}`}>
                                <strong>{match.name}</strong>
                                {match.reason && <span>{match.reason}</span>}
                            </li>
                            ))}
                        </ul>
                        </div>
                    )}
                    </>
                ) : (
                    <p role={resultState === "error" ? "alert" : undefined}>
                    {resultState === "loading"
                        ? "Looking at your photo and putting together an answer…"
                        : resultState === "unavailable"
                        ? "The AI stylist is not connected yet. Your photo has stayed in this browser."
                        : resultState === "error"
                        ? errorMessage
                        : "Your answer will appear here after you add a photo and ask a question."}
                    </p>
                )}
                </div>
            </section>
            </div>
        </main>
    
        <footer className="stylist-footer">
            <span>PASSIONISTA</span>
            <span>YOUR STYLE YOUR STORY</span>
        </footer>
        </div>
    );
    

    }
