export type ChronicleTheme = "fantasy" | "horror" | "cyberpunk" | "universal";
export type ChronicleFormat = "html" | "pdf";

export interface ExportStatus {
  status: string;
  progress: number;
  outputPath: string | null;
  currentChunk: number;
  totalChunks: number;
}
