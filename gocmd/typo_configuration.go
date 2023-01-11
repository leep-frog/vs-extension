package main

func typosSchema() *JSONSchema {
	return NewJSONArray(correctionSchema(), JSONDescription("List of corrections to automatically fix."))
}

func correctionSchema() *JSONSchema {
	return NewJSONObject(map[string]*JSONSchema{
		"words": NewJSONObject(
			nil,
			JSONMarkdownDescription("Map of typos to corrected spelling."),
		),
		"languages": NewJSONArray(
			NewJSONString(),
			JSONMarkdownDescription("Languages for which the corrections should be applied. If undefined or empty, then the correction is applied to all file types. The `*` character also indicates that these corrections should be applied globally."),
		),
		"breakChars": NewJSONString(
			JSONMarkdownDescription("Break characters for which the typos should be applied. For example, if this is `'- '`, then these corrections will only be applied when the word is followed by a space or hyphen character. This value must be a subset of `#editor.wordSeparators#`. Any characters included here that are not in `#editor.wordSeparators#` will be ignored."),
		),
		"replacementSuffix": NewJSONString(
			JSONMarkdownDescription("A suffix to add after all of the corrections listed in this object. For example, if words is `{'pritn': 'print'}` and this value is `\"hello world\"`, then typing `pritn ` will result in an auto-correction to `print \"hello world\"`"),
		),
		"replacementSuffixAfterCursor": NewJSONString(
			JSONMarkdownDescription("This field is similar to `replacementSuffix` except that this field inserts the characters after the cursor"),
		),
	}, JSONDescription("A set of corrections to automatically fix and options on those corrections"))
}
