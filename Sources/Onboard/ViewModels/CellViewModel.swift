import Foundation

enum CellState {
    case idle
    case running
    case completed(ShellResult)
    case failed(String)
}

@Observable
final class CellViewModel: Identifiable {
    let definition: CellDefinition
    let workingDirectory: URL?
    var state: CellState = .idle

    var id: String { definition.id }

    init(definition: CellDefinition, workingDirectory: URL? = nil) {
        self.definition = definition
        self.workingDirectory = workingDirectory
    }

    @MainActor
    func run() async {
        state = .running
        do {
            let result = try await ShellRunner.run(definition.command, in: workingDirectory)
            state = result.succeeded ? .completed(result) : .completed(result)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
