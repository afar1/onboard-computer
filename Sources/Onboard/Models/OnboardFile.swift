import Foundation

struct OnboardFile: Codable {
    let name: String
    let description: String?
    let cells: [CellDefinition]
}
