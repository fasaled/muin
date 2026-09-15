import { NotFoundError } from "../errors.ts";
import {
  collectRefs,
  dictGet,
  formatRef,
  isArray,
  isDict,
  isRef,
  isStream,
  parseRef,
  refKey,
  refsEqual,
  type PdfRef,
  type PdfStructure,
  type PdfValue,
} from "../pdf/model.ts";
import { incomingRefs, type ReverseIndex, buildReverseIndex } from "./reverse-index.ts";

export type Session = {
  filePath: string;
  structure: PdfStructure;
  index: ReverseIndex;
  cwd: PdfRef;
  history: PdfRef[];
  path: string[];
};

export function openSession(filePath: string, structure: PdfStructure): Session {
  const index = buildReverseIndex(structure);
  const rootVal = dictGet(structure.trailer, "/Root");
  if (!rootVal || !isRef(rootVal)) {
    throw new NotFoundError("trailer has no /Root reference");
  }
  return {
    filePath,
    structure,
    index,
    cwd: rootVal.ref,
    history: [],
    path: ["/Root"],
  };
}

export function getValue(session: Session, ref: PdfRef = session.cwd): PdfValue {
  const obj = session.structure.objects[refKey(ref)];
  if (!obj) {
    throw new NotFoundError(`no object ${formatRef(ref)}`);
  }
  return obj.value;
}

export function resolveTarget(session: Session, token: string): { ref: PdfRef; pathStep: string } {
  const asRef = parseRef(token);
  if (asRef) {
    if (!session.structure.objects[refKey(asRef)]) {
      throw new NotFoundError(`no object ${formatRef(asRef)}`);
    }
    return { ref: asRef, pathStep: formatRef(asRef) };
  }

  const current = getValue(session);
  const dict = isStream(current) ? current.dict : current;
  if (isDict(dict)) {
    const key = token.startsWith("/") ? token : `/${token}`;
    const val = dict.entries[key];
    if (val && isRef(val)) {
      return { ref: val.ref, pathStep: key };
    }
    throw new NotFoundError(`${key} is not a reference on ${formatRef(session.cwd)}`);
  }
  if (isArray(current)) {
    const i = Number(token);
    if (!Number.isInteger(i) || i < 0 || i >= current.items.length) {
      throw new NotFoundError(`no index ${token} on ${formatRef(session.cwd)}`);
    }
    const val = current.items[i];
    if (val && isRef(val)) {
      return { ref: val.ref, pathStep: `[${i}]` };
    }
    throw new NotFoundError(`index ${i} is not a reference`);
  }
  throw new NotFoundError(`cannot cd from ${formatRef(session.cwd)} via ${token}`);
}

export function cd(session: Session, token: string): Session {
  const { ref, pathStep } = resolveTarget(session, token);
  const jumpedByRef = parseRef(token) !== undefined;
  return {
    ...session,
    cwd: ref,
    history: [...session.history, session.cwd],
    path: jumpedByRef ? [pathStep] : [...session.path, pathStep],
  };
}

export function back(session: Session): Session {
  if (session.history.length === 0) {
    throw new NotFoundError("history is empty");
  }
  const cwd = session.history[session.history.length - 1];
  if (cwd === undefined) {
    throw new NotFoundError("history is empty");
  }
  return {
    ...session,
    cwd,
    history: session.history.slice(0, -1),
    path: session.path.length > 1 ? session.path.slice(0, -1) : session.path,
  };
}

export function outgoingRefs(session: Session, ref: PdfRef = session.cwd): PdfRef[] {
  return collectRefs(getValue(session, ref));
}

export function incoming(session: Session, ref: PdfRef = session.cwd): PdfRef[] {
  return incomingRefs(session.index, ref).filter((r) => !refsEqual(r, { objectNumber: 0, generation: 0 }));
}
