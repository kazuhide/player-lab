export interface Parameter {
  name: string;
  schema: string;
  optional: boolean;
  rest: boolean;
}

export interface Signature { parameters: Parameter[]; returns: string }

export interface InputSchema {
  kind: string;
  label: string;
  value?: unknown;
  options?: string[];
  item?: string;
  items?: string[];
  flags?: number[];
  properties?: { name: string; schema: string; optional: boolean }[];
  additional?: string;
  signatures?: Signature[];
  name?: string;
  factories?: string[];
}

export interface ApiEntry {
  id: string;
  category: "configuration" | "command" | "observation" | "event";
  root: string;
  schema?: string;
  reference?: string;
  name?: string;
  value?: string;
  blocked?: string;
  container?: boolean;
}

export interface ApiSchema {
  schemaVersion: number;
  playerVersion: string;
  uiVersion: string;
  nodes: Record<string, InputSchema>;
  constructors: Record<string, { signatures: Signature[] }>;
  rows: ApiEntry[];
}

/** These editor values stay separate from the SDK objects they create. */
export class CallbackInput {
  constructor(readonly body: string, readonly signature: Signature, readonly approved: boolean) {}
}
export class FactoryInput {
  constructor(readonly name: string, readonly args: unknown[], readonly overload = 0, readonly restIndex = -1) {}
}
export class ResourceInput {
  constructor(readonly id: string) {}
}
export class BinaryInput {
  constructor(readonly text: string, readonly encoding: "hex" | "base64", readonly name: string) {}
}
export class ElementInput {
  constructor(readonly tag: string) {}
}

export type ConfigRoot = "PlayerConfig" | "SourceConfig" | "UIConfig";
export type PathPart = string | number;
