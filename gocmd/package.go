package main

import "golang.org/x/exp/slices"

func groogPackage(versionOverride string) *Package {
	p := &Package{
		Name:        "groog",
		DisplayName: "groog",
		Description: "",
		Version:     "1.0.42",
		Publisher:   "groogle",
		Main:        "./out/extension.js",
		Engines: map[string]string{
			"vscode": "^1.81.0",
		},
		Repository: &Repository{
			Type: "git",
			URL:  "https://github.com/leep-frog/vs-extension",
		},
		Categories: []string{
			"Other",
		},
		Scripts: map[string]string{
			"vscode:prepublish": "npm run compile",
			"compile":           "tsc -p ./",
			"watch":             "tsc -watch -p ./",
			"pretest":           "npm run compile && npm run lint",
			"lint":              "eslint src --ext ts",
			"test":              "node ./out/test/runTest.js",
		},
		DevDependencies: map[string]string{
			"@types/vscode":                    "^1.81.0",
			"@types/mocha":                     "^10.0.1",
			"@types/node":                      "16.x",
			"@typescript-eslint/eslint-plugin": "^6.4.1",
			"@typescript-eslint/parser":        "^6.4.1",
			"eslint":                           "^8.47.0",
			"glob":                             "^10.3.3",
			"mocha":                            "^10.2.0",
			"typescript":                       "^5.1.6",
			"@vscode/test-electron":            "^2.3.4",
		},
		// onCommand activation events are auto-generated by vscode, so we don't
		// actually need to populate this at all, but it needs to be present.
		ActivationEvents: []string{},
	}

	if versionOverride != "" {
		p.Version = versionOverride
	}

	p.Contributes = &Contribution{
		Commands:      CustomCommands,
		Keybindings:   kbDefsToBindings(),
		Configuration: groogConfiguration(),
		Snipppets:     Snippets,
	}
	slices.SortFunc(p.Contributes.Commands, func(a, b *Command) bool {
		return a.Command < b.Command
	})
	return p
}

type Package struct {
	Name             string            `json:"name"`
	DisplayName      string            `json:"displayName"`
	Description      string            `json:"description"`
	Version          string            `json:"version"`
	Publisher        string            `json:"publisher"`
	Main             string            `json:"main"`
	Engines          map[string]string `json:"engines"`
	Repository       *Repository       `json:"repository"`
	Categories       []string          `json:"categories"`
	Scripts          map[string]string `json:"scripts"`
	DevDependencies  map[string]string `json:"devDependencies"`
	ActivationEvents []string          `json:"activationEvents"`
	Contributes      *Contribution     `json:"contributes"`
}

func (p *Package) sort() {
	slices.SortFunc(p.Contributes.Commands, func(a, b *Command) bool {
		return a.Title < b.Title
	})

	slices.SortFunc(p.Contributes.Keybindings, func(a, b *Keybinding) bool {
		if a.Key != b.Key {
			return a.Key < b.Key
		}
		if a.When != b.When {
			return a.When < b.When
		}
		if a.Command != b.Command {
			return a.Command < b.Command
		}
		return len(a.Args) < len(b.Args)
	})
}

type Repository struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

type Contribution struct {
	Commands      []*Command     `json:"commands"`
	Keybindings   []*Keybinding  `json:"keybindings"`
	Configuration *Configuration `json:"configuration"`
	Snipppets     []*Snippet     `json:"snippets"`
}

type Keybinding struct {
	Key     string                 `json:"key,omitempty"`
	Command string                 `json:"command,omitempty"`
	When    string                 `json:"when,omitempty"`
	Args    map[string]interface{} `json:"args,omitempty"`
}
