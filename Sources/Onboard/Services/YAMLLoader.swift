import Foundation
import Yams

enum YAMLLoader {
    static func load(from url: URL) throws -> OnboardFile {
        let data = try Data(contentsOf: url)
        let decoder = YAMLDecoder()
        return try decoder.decode(OnboardFile.self, from: data)
    }
}
