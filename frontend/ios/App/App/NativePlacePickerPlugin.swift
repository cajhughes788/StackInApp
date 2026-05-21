import Foundation
import Capacitor
import MapKit
import UIKit

@objc(NativePlacePickerPlugin)
public class NativePlacePickerPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "NativePlacePickerPlugin"
  public let jsName = "NativePlacePicker"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "pickPlace", returnType: CAPPluginReturnPromise)
  ]

  @objc func pickPlace(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      let picker = PickerViewController()
      picker.completion = { place in
        if let place = place {
          call.resolve([
            "lat": place.placemark.coordinate.latitude,
            "lng": place.placemark.coordinate.longitude,
            "address": place.name ?? place.placemark.title ?? "Selected location"
          ])
        } else {
          call.resolve(["lat": 0, "lng": 0, "address": ""])
        }
      }
      let nav = UINavigationController(rootViewController: picker)
      nav.modalPresentationStyle = .fullScreen
      self.bridge?.viewController?.present(nav, animated: true)
    }
  }
}

// MARK: - Picker view controller
fileprivate class PickerViewController: UIViewController,
  UISearchBarDelegate, UITableViewDataSource, UITableViewDelegate,
  MKLocalSearchCompleterDelegate {

  let searchBar = UISearchBar()
  let tableView = UITableView()
  let completer = MKLocalSearchCompleter()
  var results: [MKLocalSearchCompletion] = []
  var completion: ((MKMapItem?) -> Void)?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    title = "Select Location"
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .cancel,
      target: self,
      action: #selector(handleCancel)
    )

    searchBar.placeholder = "Search address or place…"
    searchBar.delegate = self
    searchBar.translatesAutoresizingMaskIntoConstraints = false

    tableView.translatesAutoresizingMaskIntoConstraints = false
    tableView.dataSource = self
    tableView.delegate = self
    tableView.keyboardDismissMode = .onDrag
    tableView.backgroundColor = .systemBackground
    tableView.tableFooterView = UIView()
    tableView.isHidden = true

    view.addSubview(searchBar)
    view.addSubview(tableView)

    NSLayoutConstraint.activate([
      searchBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      searchBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      searchBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),

      tableView.topAnchor.constraint(equalTo: searchBar.bottomAnchor, constant: 8),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])

    completer.delegate = self
  }

  @objc private func handleCancel() {
    completion?(nil)
    dismiss(animated: true)
  }

  func searchBar(_ searchBar: UISearchBar, textDidChange text: String) {
    completer.queryFragment = text
    tableView.isHidden = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    results = completer.results
    tableView.isHidden = results.isEmpty
    tableView.reloadData()
  }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { results.count }
  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
    let r = results[indexPath.row]
    cell.textLabel?.text = r.title
    cell.detailTextLabel?.text = r.subtitle
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    let selected = results[indexPath.row]
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = "\(selected.title) \(selected.subtitle)"
    let search = MKLocalSearch(request: request)
    search.start { response, _ in
      guard let item = response?.mapItems.first else { return }
      self.searchBar.text = item.name ?? item.placemark.title
      self.results = []
      self.tableView.reloadData()
      self.tableView.isHidden = true
      self.completion?(item)
      self.dismiss(animated: true)
    }
  }
}
