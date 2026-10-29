import type { ConceptOutcome, TutorBlock, TutorTurn } from "./tutor-blocks";

type SavedTutorSession = {
  turns: TutorTurn[];
  conceptIndex: number;
  lessonDone: boolean;
  outcomes: ConceptOutcome[];
  checkinResults: Record<string, { correct: boolean }>;
  activeCheckinId: string | null;
  hintedConcepts: number[];
  engine: string;
  engineDetail?: string;
};

type StoredTutorSession = SavedTutorSession & { id: string };

const DATABASE_NAME = "sarathi-tutor";
const STORE_NAME = "sessions";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open tutor history storage"));
  });
}

export async function loadTutorSession(id: string): Promise<SavedTutorSession | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result as SavedTutorSession | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not load tutor history"));
    });
  } finally {
    database.close();
  }
}

export async function saveTutorSession(id: string, session: SavedTutorSession): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ id, ...session } satisfies StoredTutorSession);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not save tutor history"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Saving tutor history was aborted"));
    });
  } finally {
    database.close();
  }
}

export function isTutorTurn(value: unknown): value is TutorTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Partial<TutorTurn>;
  if (
    typeof turn.id !== "string" ||
    (turn.author !== "student" && turn.author !== "tutor") ||
    !Array.isArray(turn.blocks)
  ) {
    return false;
  }
  return turn.blocks.every((block) => {
    if (!block || typeof block !== "object") return false;
    const candidate = block as Partial<TutorBlock>;
    return typeof candidate.id === "string" && typeof candidate.kind === "string";
  });
}
