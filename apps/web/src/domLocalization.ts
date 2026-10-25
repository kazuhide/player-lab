import { pick, type L } from "./i18n";

/** Update prose without replacing controls, their drafts, or keyboard focus. */
export class DomLocalization {
  private readonly updates: (() => void)[] = [];
  private readonly nodes = new Map<Node, (() => void)[]>();

  bind(update: () => void): void {
    this.updates.push(update);
    update();
  }

  text<T extends Node>(node: T, text: L): T {
    this.bindNode(node, () => { node.textContent = pick(text); });
    return node;
  }

  attribute<T extends Element>(node: T, name: string, text: L): T {
    this.bindNode(node, () => { node.setAttribute(name, pick(text)); });
    return node;
  }

  private bindNode(node: Node, update: () => void): void {
    const updates = this.nodes.get(node) ?? [];
    updates.push(update);
    this.nodes.set(node, updates);
    update();
  }

  forget(element: Node): void {
    for (const node of this.nodes.keys()) if (element.contains(node)) this.nodes.delete(node);
  }

  refresh(): void {
    this.updates.forEach(update => update());
    this.nodes.forEach(updates => updates.forEach(update => update()));
  }
}
