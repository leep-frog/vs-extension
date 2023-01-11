
// This file contains external (ie used in settings.json) facing

// Words is a map from typo to corrected spelling.
export interface Words {
  [key: string]: string;
}

export interface Correction {
  // The list of languages for which this correction applies.
  // If not provided, then the correction is applied for all languages.
  languages?: string[];
  // Map of all corrections.
  words: Words;
  // Break characters that apply for these corrections. If undefined, then
  // default break characters are used.
  breakChars?: string;
  // Words to add after the replacement, but before the cursor.
  replacementSuffix?: string;
  // Words to add after the replacement and after the cursor.
  replacementSuffixAfterCursor?: string;
}

const goLanguageKey = "golang";
const jsoncLanguageKey = "jsonc";
const jsonLanguageKey = "json";
const typescriptLanguageKey = "typescript";

export function defaultCorrections() : Correction[] {
  return [
    {
      // languages: [
      //   typescriptLanguageKey
      // ],
      words: {
        "sim": "vscode.window.showInformationMessage(\"",
        "sem": "vscode.window.showInformationMessage(\"",
      },
      // TODO: Replace break character option
      replacementSuffix: "\")",
    },
  ];
}
