import { collectRefs, refKey, type PdfRef, type PdfStructure } from "../pdf/model.ts";

export type ReverseIndex = Map<string, PdfRef[]>;

export function buildReverseIndex(structure: PdfStructure): ReverseIndex {
  const incoming: ReverseIndex = new Map();
  const add = (from: PdfRef, to: PdfRef) => {
    const key = refKey(to);
    const list = incoming.get(key);
    if (list) list.push(from);
    else incoming.set(key, [from]);
  };

  for (const obj of Object.values(structure.objects)) {
    for (const to of collectRefs(obj.value)) {
      add(obj.ref, to);
    }
  }
  const trailerRefs = collectRefs(structure.trailer);
  const trailerFrom: PdfRef = { objectNumber: 0, generation: 0 };
  for (const to of trailerRefs) add(trailerFrom, to);
  return incoming;
}

export function incomingRefs(index: ReverseIndex, ref: PdfRef): PdfRef[] {
  return index.get(refKey(ref)) ?? [];
}
