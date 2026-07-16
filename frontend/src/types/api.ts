// Friendly aliases over the generated OpenAPI types. This file is the stable
// import surface — `generated.ts` is overwritten by `npm run gen:types`, so
// nothing outside this file should import from it directly.
import type { components } from "./generated";

export type WorkspaceCreated = components["schemas"]["WorkspaceCreated"];
export type JoinResult = components["schemas"]["JoinResult"];
export type Member = components["schemas"]["MemberOut"];
export type Tab = components["schemas"]["TabOut"];
export type TabType = components["schemas"]["TabType"];
export type TransferType = components["schemas"]["TransferType"];
export type TransferHistoryItem = components["schemas"]["TransferHistoryOut"];
