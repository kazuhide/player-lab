import { DomLocalization } from "../domLocalization";
import { BinaryInput, CallbackInput, ElementInput, FactoryInput, ResourceInput,
  type ApiSchema, type InputSchema } from "./types";
import { safeKey } from "./values";

export interface ValueEditor { element: HTMLElement; read: () => unknown; relocalize?: () => void; refresh?: () => void }
export interface EditorResources { list: (schema: InputSchema) => { id: string; label: string }[] }

/** Describe editor input data without constructing or invoking SDK values. */
export function editorComparisonValue(value: unknown): unknown {
  if (value instanceof CallbackInput) return { callback: value.body, approved: value.approved, signature: value.signature };
  if (value instanceof FactoryInput) return { factory: value.name, args: value.args.map(editorComparisonValue), overload: value.overload, restIndex: value.restIndex };
  if (value instanceof ResourceInput) return { resource: value.id };
  if (value instanceof BinaryInput) return { binary: value.text, encoding: value.encoding, name: value.name };
  if (value instanceof ElementInput) return { element: value.tag };
  if (Array.isArray(value)) return value.map(editorComparisonValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, editorComparisonValue(item)]));
  }
  return value;
}

function option(value: string, text: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = text;
  return element;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.addEventListener("click", action);
  return element;
}
function field(name: string, element: HTMLElement): HTMLElement {
  const label = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = name;
  label.className = "api-editor-field";
  label.append(title, element);
  return label;
}

/** Build inputs lazily; a component tree is expanded only when its factory is selected. */
export function valueEditor(catalog: ApiSchema, id: string, resources: EditorResources,
  initial?: unknown, depth = 0): ValueEditor {
  const schema = catalog.nodes[id];
  if (!schema) throw new Error("Missing editor input type.");
  const element = document.createElement("div");
  element.className = "api-value";
  const labels = new DomLocalization();
  const children = new Set<ValueEditor>();
  const relocalize = () => { labels.refresh(); children.forEach(editor => editor.relocalize?.()); };
  const refreshers: (() => void)[] = [];
  const refresh = () => { refreshers.forEach(update => update()); children.forEach(editor => editor.refresh?.()); };
  const resourceOptions = (select: HTMLSelectElement, prefix: string) => {
    const fixed = [...select.options];
    const unavailable = labels.text(option("", ""), { ja: "このSDKオブジェクトは利用できません。", en: "This SDK object is unavailable." });
    unavailable.disabled = true;
    const update = () => {
      const selected = select.value;
      const dynamic = resources.list(schema).map(resource => option(prefix + resource.id, resource.label));
      select.replaceChildren(...fixed, ...dynamic);
      const missing = selected !== "" && ![...select.options].some(option => option.value === selected);
      if (missing) { unavailable.value = selected; select.append(unavailable); }
      select.value = selected;
      if (missing) select.setAttribute("aria-invalid", "true");
      else select.removeAttribute("aria-invalid");
    };
    refreshers.push(update);
    update();
  };
  if (depth > 16) {
    labels.text(element, { ja: "この入力は深すぎます。親の入力から構成を簡略化してください。", en: "This input is too deep. Simplify its parent value." });
    return { element, relocalize, read: () => { throw new Error("Input nesting exceeds the editor limit."); } };
  }
  const child = (key: string, value?: unknown) => {
    const editor = valueEditor(catalog, key, resources, value, depth + 1);
    children.add(editor);
    return editor;
  };
  if (["undefined", "void", "null", "literal", "never"].includes(schema.kind)) {
    element.textContent = schema.kind === "literal" ? String(schema.value) : schema.kind;
    return { element, read: () => schema.kind === "literal" ? schema.value : schema.kind === "null" ? null : undefined };
  }
  if (schema.kind === "string" || schema.kind === "number") {
    const input = document.createElement("input");
    input.type = "text";
    input.value = initial === undefined ? "" : String(initial);
    input.maxLength = 65536;
    if (schema.kind === "number") input.inputMode = "decimal";
    input.setAttribute("aria-label", schema.label);
    element.append(input);
    return { element, read: () => schema.kind === "string" ? input.value : input.value.trim() === "" ? undefined : Number(input.value) };
  }
  if (schema.kind === "boolean") {
    const select = document.createElement("select");
    select.append(option("false", "false"), option("true", "true"));
    select.value = String(initial === true);
    select.setAttribute("aria-label", schema.label);
    element.append(select);
    return { element, read: () => select.value === "true" };
  }
  if (schema.kind === "union") {
    const select = document.createElement("select");
    const body = document.createElement("div");
    const options = schema.options!;
    labels.attribute(select, "aria-label", { ja: "入力の型", en: "Input type" });
    for (const key of options) select.append(option(key, catalog.nodes[key]!.label));
    const found = options.find(key => {
      const node = catalog.nodes[key]!;
      return initial === undefined ? node.kind === "undefined" : node.kind === typeof initial || node.kind === "literal" && node.value === initial
        || initial instanceof CallbackInput && node.kind === "function" || initial instanceof FactoryInput && node.kind === "instance";
    });
    if (found) select.value = found;
    let editor: ValueEditor;
    const branches = new Map<string, ValueEditor>();
    const update = () => {
      editor = branches.get(select.value) ?? child(select.value, initial);
      branches.set(select.value, editor);
      body.replaceChildren(editor.element);
    };
    select.addEventListener("change", update);
    update();
    element.append(select, body);
    return { element, relocalize, refresh, read: () => editor.read() };
  }
  if (schema.kind === "array" || schema.kind === "tuple") {
    const list = document.createElement("div");
    const items: { editor: ValueEditor; element: HTMLElement }[] = [];
    const append = (value?: unknown) => {
      if (items.length >= 256) return;
      const key = schema.kind === "array" ? schema.item! : schema.items![items.length];
      if (!key) return;
      const item = child(key, value);
      const row = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = `[${items.length}]`;
      const entry = { editor: item, element: row };
      row.append(legend, item.element, labels.text(button("", () => {
        children.delete(item);
        items.splice(items.indexOf(entry), 1); labels.forget(row); row.remove();
        items.forEach((item, index) => { item.element.querySelector("legend")!.textContent = `[${index}]`; });
      }), { ja: "削除", en: "Remove" }));
      items.push(entry);
      list.append(row);
    };
    if (Array.isArray(initial)) initial.forEach(append);
    else if (schema.kind === "tuple") schema.items!.forEach(() => append());
    element.append(list, labels.text(button("", () => append()), { ja: "項目を追加", en: "Add item" }));
    return { element, relocalize, refresh, read: () => items.map(item => item.editor.read()) };
  }
  if (schema.kind === "object") {
    const current = initial && typeof initial === "object" ? initial as Record<string, unknown> : {};
    const values = new Map<string, () => unknown>();
    const list = document.createElement("div");
    const append = (name: string, key: string, optional: boolean, removable = false) => {
      safeKey(name);
      if (values.has(name)) throw new Error("This property already exists.");
      const row = document.createElement("fieldset");
      const legend = document.createElement("legend");
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = !optional || Object.prototype.hasOwnProperty.call(current, name);
      enabled.disabled = !optional;
      const label = document.createElement("label");
      label.append(enabled, document.createTextNode(" " + name));
      legend.append(label);
      const body = document.createElement("div");
      let editor: ValueEditor | undefined;
      const update = () => {
        body.hidden = !enabled.checked;
        if (enabled.checked && !editor) { editor = child(key, current[name]); body.append(editor.element); }
      };
      enabled.addEventListener("change", update);
      update();
      row.append(legend, body);
      if (removable) row.append(labels.text(button("", () => {
        values.delete(name); if (editor) children.delete(editor); labels.forget(row); row.remove();
      }), { ja: "プロパティを削除", en: "Remove property" }));
      values.set(name, () => enabled.checked ? editor!.read() : undefined);
      list.append(row);
    };
    for (const property of schema.properties!) append(property.name, property.schema, property.optional);
    if (schema.additional) {
      for (const name of Object.keys(current)) if (!values.has(name)) append(name, schema.additional, false, true);
      const name = document.createElement("input");
      name.type = "text";
      labels.attribute(name, "aria-label", { ja: "プロパティ名", en: "Property name" });
      const error = document.createElement("span");
      error.setAttribute("role", "status");
      const nameField = field("", name);
      labels.text(nameField.firstChild!, { ja: "プロパティ名", en: "Property name" });
      element.append(nameField,
        labels.text(button("", () => {
          try {
            if (!name.value || values.size >= 256) throw new Error("Enter a property name; the editor supports up to 256 entries.");
            append(name.value, schema.additional!, false, true); name.value = ""; error.textContent = "";
          } catch (failure) { error.textContent = String(failure); }
        }), { ja: "プロパティを追加", en: "Add property" }), error);
    }
    element.append(list);
    return { element, relocalize, refresh, read: () => Object.fromEntries([...values].flatMap(([name, read]) => {
      const value = read(); return value === undefined ? [] : [[name, value]];
    })) };
  }
  if (schema.kind === "function") {
    const signatures = schema.signatures!;
    const select = document.createElement("select");
    select.append(labels.text(option("new", ""), { ja: "関数を編集", en: "Edit callback" }));
    resourceOptions(select, "");
    const signatureSelect = document.createElement("select");
    labels.attribute(signatureSelect, "aria-label", { ja: "関数のシグネチャー", en: "Callback signature" });
    signatures.forEach((signature, index) => signatureSelect.append(option(String(index),
      `(${signature.parameters.map(p => p.name + (p.optional ? "?" : "") + ": " + catalog.nodes[p.schema]!.label).join(", ")}) => ${catalog.nodes[signature.returns]!.label}`)));
    const textarea = document.createElement("textarea");
    textarea.rows = 7;
    textarea.spellcheck = false;
    textarea.maxLength = 65536;
    textarea.value = initial instanceof CallbackInput ? initial.body : "return undefined;";
    labels.attribute(textarea, "aria-label", { ja: "JavaScriptの関数本体", en: "JavaScript callback body" });
    const approved = document.createElement("input");
    approved.type = "checkbox";
    const consent = document.createElement("label");
    consent.append(approved, labels.text(document.createTextNode(""), { ja: "Apply後にこの関数をこの画面内で実行する", en: "Allow this callback to run in this page after Apply" }));
    const note = document.createElement("p");
    labels.text(note, { ja: "引数名は上記の型定義に従います。SDKが呼び出す処理をJavaScriptで記述してください。lab.uiからUIのクラスを利用できます。", en: "Use the parameter names above. Enter the JavaScript body that the SDK will call. UI classes are available through lab.ui." });
    const body = document.createElement("div");
    body.append(signatureSelect, note, textarea, consent);
    select.addEventListener("change", () => { body.hidden = select.value !== "new"; });
    element.append(select, body);
    return { element, relocalize, refresh, read: () => select.value === "new" ? new CallbackInput(textarea.value, signatures[Number(signatureSelect.value)]!, approved.checked) : new ResourceInput(select.value) };
  }
  if (schema.kind === "binary") {
    const encoding = document.createElement("select");
    encoding.append(option("hex", "Hex"), option("base64", "Base64"));
    const textarea = document.createElement("textarea");
    textarea.rows = 4;
    labels.attribute(textarea, "aria-label", { ja: "バイナリデータ", en: "Binary data" });
    if (initial instanceof BinaryInput) { encoding.value = initial.encoding; textarea.value = initial.text; }
    element.append(encoding, textarea);
    return { element, relocalize, read: () => new BinaryInput(textarea.value, encoding.value as "hex" | "base64", schema.name!) };
  }
  if (schema.kind === "instance") {
    const select = document.createElement("select");
    select.append(labels.text(option("", ""), { ja: "実体または生成方法を選択", en: "Choose an instance or factory" }));
    for (const name of schema.factories ?? []) select.append(option("factory:" + name, "new " + name));
    const tag = schema.name === "HTMLVideoElement" ? "video" : schema.name === "HTMLImageElement" ? "img" : schema.name === "HTMLCanvasElement" ? "canvas"
      : schema.name === "HTMLElement" || schema.name === "Element" || schema.name === "Node" ? "div" : undefined;
    if (tag) select.append(option("element:" + tag, `document.createElement(${JSON.stringify(tag)})`));
    resourceOptions(select, "resource:");
    const body = document.createElement("div");
    let args: ValueEditor[] = [];
    let overload = 0;
    let selectedFactory = "";
    const factories = new Map<string, { nodes: ChildNode[]; args: ValueEditor[]; overload: number }>();
    const update = () => {
      if (selectedFactory) factories.set(selectedFactory, { nodes: [...body.childNodes], args, overload });
      body.replaceChildren(); args = [];
      selectedFactory = "";
      if (select.value.startsWith("factory:")) {
        const name = select.value.slice(8);
        selectedFactory = name;
        const saved = factories.get(name);
        if (saved) { args = saved.args; overload = saved.overload; body.append(...saved.nodes); return; }
        const signatures = catalog.constructors[name]!.signatures;
        const choice = document.createElement("select");
        labels.attribute(choice, "aria-label", { ja: "コンストラクターのシグネチャー", en: "Constructor signature" });
        signatures.forEach((signature, index) => choice.append(option(String(index),
          `(${signature.parameters.map(p => p.name + (p.optional ? "?" : "") + ": " + catalog.nodes[p.schema]!.label).join(", ")})`)));
        choice.value = String(initial instanceof FactoryInput && initial.name === name ? initial.overload : 0);
        const fields = document.createElement("div");
        let previousChoice = "";
        const argumentDrafts = new Map<string, { nodes: ChildNode[]; args: ValueEditor[] }>();
        const renderArgs = () => {
          if (previousChoice) argumentDrafts.set(previousChoice, { nodes: [...fields.childNodes], args });
          previousChoice = choice.value;
          overload = Number(choice.value); args = []; fields.replaceChildren();
          const saved = argumentDrafts.get(choice.value);
          if (saved) { args = saved.args; fields.append(...saved.nodes); return; }
          const signature = signatures[overload]!;
          const initialArgs = initial instanceof FactoryInput && initial.name === name ? initial.args : [];
          for (const [index, parameter] of signature.parameters.entries()) {
          const editor = child(parameter.schema, initialArgs[index]);
          const enabled = document.createElement("input");
          enabled.type = "checkbox"; enabled.checked = !parameter.optional || initialArgs[index] !== undefined;
          const row = document.createElement("fieldset");
          const label = document.createElement("label");
          label.append(enabled, document.createTextNode(" " + parameter.name));
          const show = () => { editor.element.hidden = !enabled.checked; };
          enabled.disabled = !parameter.optional;
          enabled.addEventListener("change", show); show();
          row.append(label, editor.element); fields.append(row);
          args.push({ element: row, read: () => enabled.checked ? editor.read() : undefined });
          }
        };
        choice.addEventListener("change", renderArgs); renderArgs();
        body.append(choice, fields);
      }
    };
    if (initial instanceof FactoryInput) select.value = "factory:" + initial.name;
    select.addEventListener("change", update); update();
    element.append(select, body);
    return { element, relocalize, refresh, read: () => {
      if (select.value.startsWith("factory:")) {
        const name = select.value.slice(8);
        const restIndex = catalog.constructors[name]!.signatures[overload]!.parameters.findIndex(parameter => parameter.rest);
        return new FactoryInput(name, args.map(arg => arg.read()), overload, restIndex);
      }
      if (select.value.startsWith("resource:")) return new ResourceInput(select.value.slice(9));
      if (select.value.startsWith("element:")) return new ElementInput(select.value.slice(8));
      throw new Error("Choose a real SDK instance or a supported constructor.");
    } };
  }
  if (schema.kind === "unknown") {
    const textarea = document.createElement("textarea");
    textarea.rows = 4;
    textarea.value = initial === undefined ? "null" : JSON.stringify(initial, null, 2);
    labels.attribute(textarea, "aria-label", { ja: "SDKが型を限定していないデータ", en: "Data without an SDK type restriction" });
    element.append(textarea);
    return { element, relocalize, read: () => {
      if (textarea.value.length > 65536) throw new Error("Input exceeds 64 KiB.");
      return JSON.parse(textarea.value);
    } };
  }
  labels.text(element, { ja: "この型は値として作成できません。必要なSDK実体を先に取得してください。", en: "This type cannot be created as data. Obtain the required SDK instance first." });
  return { element, relocalize, read: () => { throw new Error("A real SDK object is required."); } };
}
