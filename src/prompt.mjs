export function stripAnsi(text) {
  return String(text ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function tailContextLines(text, count = 10) {
  return stripAnsi(text)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .slice(-count);
}

function inputChoice(value) {
  return { send: "input", value };
}

function keyChoice(value) {
  return { send: "keys", keys: [value] };
}

// Inspects the tail of terminal output and, when a permission/confirmation
// prompt is present, returns how the user can approve or reject it. Shared by
// the gateway task-state detector and the mobile /prompt endpoint so that both
// stay in sync with the browser UI's detection.
export function findPrompt(text) {
  const lines = tailContextLines(text, 10);
  if (!lines.length) return null;
  const context = lines.map((line) => line.trim()).join("\n");

  if (/allow\?\s*YES\?/i.test(context)) {
    return {
      signature: context,
      context,
      approve: inputChoice("YES"),
      reject: inputChoice("NO")
    };
  }

  let reject = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    const numericReject = line.match(
      /(?:^|[\s>❯›»])([1-9])\s*[\).:\]-]\s*(?:no|reject|deny|cancel)\b/i
    );
    if (numericReject && !reject) reject = inputChoice(numericReject[1]);

    if (/\ballow\s+once\b.*\ballow\s+(?:always|allways)\b.*\breject\b/i.test(line)) {
      return {
        signature: context,
        context,
        approve: keyChoice("Enter"),
        reject: reject ?? keyChoice("Escape")
      };
    }

    const numericAllow = line.match(
      /(?:^|[\s>❯›»])([1-9])\s*[\).:\]-]\s*(?:yes|allow(?:\s+(?:once|always|allways))?)\b/i
    );
    if (numericAllow) {
      return {
        signature: context,
        context,
        approve: inputChoice(numericAllow[1]),
        reject: reject ?? keyChoice("C-c")
      };
    }

    if (/(?:^|[\s>❯›»])a\s*[\).:\]-]\s*allow(?:\s+(?:once|always|allways))?\b/i.test(line)) {
      return {
        signature: context,
        context,
        approve: inputChoice("a"),
        reject: reject ?? keyChoice("C-c")
      };
    }

    if (/^\s*allow(?:\s+(?:once|always|allways))?\b/i.test(line)) {
      return {
        signature: context,
        context,
        approve: inputChoice("1"),
        reject: reject ?? keyChoice("C-c")
      };
    }

    if (/(?:^|[\s>❯›»])y\s*[\).:\]-]\s*yes\b/i.test(line)) {
      return {
        signature: context,
        context,
        approve: inputChoice("y"),
        reject: reject ?? keyChoice("C-c")
      };
    }
  }

  return null;
}

export function hasConfirmationPrompt(text) {
  return findPrompt(text) !== null;
}
