import Foundation

enum CellType: String, Codable {
    case bash
}

struct CellDefinition: Codable, Identifiable {
    let type: CellType
    let title: String
    let description: String?
    let command: String

    var id: String { title }
}
