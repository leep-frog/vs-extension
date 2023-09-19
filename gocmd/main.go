package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	"github.com/leep-frog/command"
	"github.com/leep-frog/command/sourcerer"
)

func main() {
	os.Exit(sourcerer.Source(
		[]sourcerer.CLI{&cli{}},
		sourcerer.NewAliaser("vu", "v", "u"),
	))
}

type cli struct{}

func (*cli) Name() string    { return "v" }
func (*cli) Setup() []string { return nil }
func (*cli) Changed() bool   { return false }

var (
	versionRegex = regexp.MustCompile("^(\\s*Version:\\s*[\"`])([0-9\\.]+)([\"`],)$")
)

func (c *cli) Node() command.Node {
	versionSectionArg := command.OptionalArg[int]("VERSION", "Version section offset (0 for smallest, 1 for middle, 2 for major)", command.Default(0), command.Between(0, 2, true))

	runtimeNode := command.RuntimeCaller()

	return &command.BranchNode{
		Branches: map[string]command.Node{
			"update u": command.SerialNodes(
				versionSectionArg,
				&command.ExecutorProcessor{func(o command.Output, d *command.Data) error {
					_, fileName, _, ok := runtime.Caller(0)
					if !ok {
						return o.Stderrf("failed to get runtime.Caller")
					}

					// Go two directories up (to groog root)
					packageFile := filepath.Join(filepath.Dir(fileName), "package.go")

					b, err := os.ReadFile(packageFile)
					if err != nil {
						return o.Annotatef(err, "failed to read package.go")
					}

					contents := strings.Split(string(b), "\n")
					var newContents []string
					var replaced int
					var newVersion string
					for _, line := range contents {
						m := versionRegex.FindStringSubmatch(line)
						if len(m) > 0 {
							replaced++
							prefix, version, suffix := m[1], m[2], m[3]
							versionParts := strings.Split(version, ".")

							indexToChange := len(versionParts) - 1 - versionSectionArg.Get(d)

							vNum, err := strconv.Atoi(versionParts[indexToChange])
							if err != nil {
								return o.Annotatef(err, "failed to convert version")
							}

							// Clear out smaller versions
							for i := indexToChange; i < len(versionParts); i++ {
								versionParts[i] = "0"
							}
							versionParts[indexToChange] = fmt.Sprintf("%d", vNum+1)
							newVersion = strings.Join(versionParts, ".")
							line = fmt.Sprintf("%s%s%s", prefix, newVersion, suffix)
						}
						newContents = append(newContents, line)
					}

					if replaced == 0 {
						return o.Stderrf("Made no replacements")
					}

					if err := os.WriteFile(packageFile, []byte(strings.Join(newContents, "\n")), 0644); err != nil {
						return o.Annotatef(err, "failed to write new contents to package.go")
					}

					o.Stdoutln("Successfully updated to new version:", newVersion)
					return nil
				}},
			),
		},
		Default: command.SerialNodes(
			runtimeNode,
			&command.ExecutorProcessor{func(o command.Output, d *command.Data) error {
				path := filepath.Join(filepath.Dir(filepath.Dir(runtimeNode.Get(d))), "package.json")
				if err := c.execute(path); err != nil {
					return err
				}

				o.Stdoutln("Successfully updated package.json")
				return nil
			}},
		),
	}
}

func (c *cli) execute(filename string) error {
	p := groogPackage()

	j, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal json: %v", err)
	}

	if err := os.WriteFile(filename, append(j, byte('\n')), 0644); err != nil {
		return fmt.Errorf("failed to write json to output file: %v", err)
	}

	return nil
}
