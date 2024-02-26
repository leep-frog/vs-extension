package main

import "golang.org/x/exp/slices"

func groogPackage(versionOverride string) *Package {
	p := &Package{
		Name:        "groog",
		DisplayName: "groog",
		Description: "",
		Version:     "2.4.3",
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
			"vscode:prepublish": "npm run esbuild-base -- --minify",
			"compile":           "tsc -p ./",
			"watch":             "tsc -watch -p ./",
			"pretest":           "npm run compile",
			"lint":              "eslint src --ext ts",
			"test":              "vscode-test",
			"esbuild-base":      "esbuild ./src/extension.ts --bundle --outfile=out/main.js --external:vscode --format=cjs --platform=node",
			"esbuild":           "npm run esbuild-base -- --sourcemap",
			"esbuild-watch":     "npm run esbuild-base -- --sourcemap --watch",
			"test-compile":      "tsc -p ./",
		},
		Dependencies: map[string]string{
			"await-lock":             "^2.2.2",
			"escape-string-regexp":   "^5.0.0",
			"sorted-array-functions": "^1.3.0",
		},
		DevDependencies: map[string]string{
			"@types/vscode":                    "^1.81.0",
			"@types/mocha":                     "^10.0.1",
			"@types/node":                      "16.x",
			"@typescript-eslint/eslint-plugin": "^6.4.1",
			"@typescript-eslint/parser":        "^6.4.1",
			"eslint":                           "^8.47.0",
			"esbuild":                          "^0.20.0",
			"glob":                             "^10.3.3",
			"mocha":                            "^10.2.0",
			"typescript":                       "^5.1.6",
			"@vscode/test-electron":            "^2.3.9",
			"@vscode/test-cli":                 "^0.0.4",
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
	sortFunc(p.Contributes.Commands, func(a, b *Command) bool {
		return a.Command < b.Command
	})
	return p
}

func sortFunc[T any](ts []T, f func(a, b T) bool) {
	slices.SortFunc(ts, func(a, b T) int {
		if f(a, b) {
			return -1
		}
		return 1
	})
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
	Dependencies     map[string]string `json:"dependencies"`
	DevDependencies  map[string]string `json:"devDependencies"`
	ActivationEvents []string          `json:"activationEvents"`
	Contributes      *Contribution     `json:"contributes"`
}

func (p *Package) sort() {
	sortFunc(p.Contributes.Commands, func(a, b *Command) bool {
		return a.Title < b.Title
	})

	sortFunc(p.Contributes.Keybindings, func(a, b *Keybinding) bool {
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
