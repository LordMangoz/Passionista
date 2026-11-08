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
type StylistMatch = {
  clothing_item_id: string;
  image_id: string;
  category: string;
  subcategory: string;
  primary_color: string;
  style_tags: string;
  name: string;
  reason: string;
  imageUrl: string;
};
type StylistResult = {
  answer: string;
  matches?: StylistMatch[];
};
type ResultState = "idle" | "loading" | "ready" | "error";

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
  const [isSavingOutfit, setIsSavingOutfit] = useState(false);
  const [outfitSaveMessage, setOutfitSaveMessage] = useState("");
  const [outfitSaveError, setOutfitSaveError] = useState("");
  const previewUrlRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const matchImageUrlsRef = useRef(new Set<string>());

  useEffect(() => {
    const previousTitle = document.title;
    const matchImageUrls = matchImageUrlsRef.current;
    document.title = "Stylist Studio | Passionista";
    return () => {
      document.title = previousTitle;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      for (const url of matchImageUrls) URL.revokeObjectURL(url);
      matchImageUrls.clear();
      requestRef.current?.abort();
    };
  }, []);

  const selectedQuestion = questions.find((question) => question.id === selectedQuestionId)!;

  function clearMatchImages() {
    for (const url of matchImageUrlsRef.current) URL.revokeObjectURL(url);
    matchImageUrlsRef.current.clear();
  }

  function clearAnalysis() {
    requestRef.current?.abort();
    clearMatchImages();
    setResult(null);
    setResultState("idle");
    setErrorMessage("");
    setOutfitSaveMessage("");
    setOutfitSaveError("");
  }

  function chooseFile(nextFile?: File) {
    if (!nextFile) return;
    clearAnalysis();
    if (!ACCEPTED_IMAGE_TYPES.includes(nextFile.type)) {
      setErrorMessage("Choose a JPG, PNG, or WebP image.");
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

  // Send the shop photo for this question without saving it to the wardrobe.
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
    const body = new FormData();
    body.append("image", file);
    body.append("questionID", selectedQuestion.id);

    const response = await fetch("/api/stylist/ask", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body,
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

    let matches: StylistMatch[] | undefined;
    if (selectedQuestion.id === "wardrobe-match") {
      if (!("matches" in data) || !Array.isArray(data.matches)) {
        throw new Error("The stylist returned an unexpected outfit recommendation.");
      }

      const suggestions = data.matches.filter(
        (match): match is Omit<StylistMatch, "imageUrl"> =>
          match !== null &&
          typeof match === "object" &&
          "clothing_item_id" in match &&
          typeof match.clothing_item_id === "string" &&
          "image_id" in match &&
          typeof match.image_id === "string" &&
          "category" in match &&
          typeof match.category === "string" &&
          "subcategory" in match &&
          typeof match.subcategory === "string" &&
          "primary_color" in match &&
          typeof match.primary_color === "string" &&
          "style_tags" in match &&
          typeof match.style_tags === "string" &&
          "name" in match &&
          typeof match.name === "string" &&
          "reason" in match &&
          typeof match.reason === "string",
      );

      const imageResults = await Promise.allSettled(suggestions.map(async (match) => {
        const imageResponse = await fetch(
          `/api/images/${encodeURIComponent(match.image_id)}/file`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
          },
        );
        if (!imageResponse.ok) {
          throw new Error(await getApiError(imageResponse, "Could not load a wardrobe match"));
        }
        const imageUrl = URL.createObjectURL(await imageResponse.blob());
        matchImageUrlsRef.current.add(imageUrl);
        return { ...match, imageUrl };
      }));

      if (controller.signal.aborted) {
        clearMatchImages();
        return;
      }

      const failedImage = imageResults.find((entry) => entry.status === "rejected");
      if (failedImage?.status === "rejected") {
        clearMatchImages();
        throw failedImage.reason;
      }

      matches = imageResults.flatMap((entry) =>
        entry.status === "fulfilled" ? [entry.value] : [],
      ).sort((a, b) => outfitOrder(a) - outfitOrder(b));
    }

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

function outfitOrder(match: Pick<StylistMatch, "category" | "subcategory">): number {
  const subcategory = match.subcategory.toLowerCase();
  const category = match.category.toLowerCase();
  if (subcategory.includes("sock")) return 3;
  if (/\b(shoe|sneaker|boot|sandal)\b/.test(subcategory)) return 4;
  if (category === "top" || category === "dress") return 0;
  if (category === "outerwear") return 1;
  if (category === "bottom") return 2;
  if (category === "footwear") return 4;
  if (category === "accessory") return 5;
  return 6;
}

async function saveStylistOutfit() {
  if (!file || !result?.matches?.length || isSavingOutfit) return;
  setIsSavingOutfit(true);
  setOutfitSaveMessage("");
  setOutfitSaveError("");
  try {
    if (!auth0Audience) throw new Error("Auth0 API audience is not configured.");
    const accessToken = await getAccessTokenSilently({
      authorizationParams: { audience: auth0Audience },
    });
    if (!accessToken) throw new Error("Auth0 did not return an access token.");

    let sourceImageId = imageId;
    if (!sourceImageId) {
      const photoBody = new FormData();
      photoBody.append("image", file);
      const photoResponse = await fetch("/api/stylist/images", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: photoBody,
      });
      if (!photoResponse.ok) {
        throw new Error(await getApiError(photoResponse, "Could not save the starting photo"));
      }
      const uploaded: unknown = await photoResponse.json();
      if (!uploaded || typeof uploaded !== "object" ||
          !("image_id" in uploaded) || typeof uploaded.image_id !== "string") {
        throw new Error("The server did not return an image ID.");
      }
      sourceImageId = uploaded.image_id;
      setImageId(sourceImageId);
    }

    const response = await fetch("/api/outfits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Outfit with ${file?.name.replace(/\.[^.]+$/, "") || "your piece"}`.slice(0, 80),
        source_image_id: sourceImageId,
        clothing_item_ids: result.matches.map((match) => match.clothing_item_id),
      }),
    });
    if (!response.ok) throw new Error(await getApiError(response, "Could not save outfit"));
    setOutfitSaveMessage("Outfit saved to your wardrobe.");
  } catch (error) {
    setOutfitSaveError(error instanceof Error ? error.message : "Could not save outfit.");
  } finally {
    setIsSavingOutfit(false);
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
    
                    <span className="file-hint">JPG, PNG, OR WEBP · UP TO 10 MB</span>
                </div>
                )}
    
                {errorMessage && resultState === "idle" && (
                <p className="upload-error" role="alert">{errorMessage}</p>
                )}

                {previewUrl && selectedQuestionId === "wardrobe-match" && resultState === "ready" && result && (
                  <section className="outfit-suggestions" aria-label="Visual outfit suggestions">
                    <h3>Outfit pairings</h3>
                    <p>Styled from top to bottom</p>
                    {result.matches?.length ? (
                      <ol>
                        {result.matches.map((match) => (
                          <li key={match.clothing_item_id}>
                            <img src={match.imageUrl} alt={match.name} />
                            <div>
                              <span>{match.category}</span>
                              <strong>{match.name}</strong>
                              {match.reason && <p>{match.reason}</p>}
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>No matching items from your wardrobe were found for this outfit.</p>
                    )}
                    {result.matches?.length ? (
                      <>
                        <button
                          className="save-outfit-button"
                          type="button"
                          onClick={() => void saveStylistOutfit()}
                          disabled={isSavingOutfit || Boolean(outfitSaveMessage)}
                        >
                          {isSavingOutfit ? "Saving outfit…" : outfitSaveMessage ? "Saved to wardrobe" : "Save this outfit"}
                          <span aria-hidden="true">→</span>
                        </button>
                        {outfitSaveError && <p className="outfit-save-error" role="alert">{outfitSaveError}</p>}
                        {outfitSaveMessage && <p className="outfit-save-success" role="status">{outfitSaveMessage}</p>}
                      </>
                    ) : null}
                  </section>
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
    
                    </>
                ) : (
                    <p role={resultState === "error" ? "alert" : undefined}>
                    {resultState === "loading"
                        ? "Looking at your photo and putting together an answer…"
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
