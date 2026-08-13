# prism1.2 - OMD Fleet Route Verification

A web-based fleet route verification application built with Leaflet.js for visualizing and verifying driver routes, geofences, and fleet operations.

## Features

- **Interactive Map**: Built on Leaflet.js with multiple map layers (Dark, Satellite)
- **Live Fleet Tracking**: Real-time visualization of fleet vehicles and drivers
- **Geofence Zones**: Display and manage geofence boundaries
- **Route Verification**: Verify and validate fleet routes
- **Multi-language Support**: Internationalization (i18n) with support for multiple languages including:
  - English
  - arabic
  - French
- **Driver Labels**: Toggle driver name visibility on the map
- **Theme Support**: Multiple themes (Dark, Light, Black)
- **Responsive Design**: Works on desktop and mobile devices

## Technologies Used

- **Leaflet.js**: Open-source JavaScript library for interactive maps
- **HTML5/CSS3**: Modern web standards
- **JavaScript (ES6+)**: Client-side logic
- **Mapbox/OSM**: Map tile providers

## Project Structure

```
/workspace
├── index.html      # Main application (single-page app with embedded CSS/JS)
├── README.md       # This file
└── LICENSE         # License information
```

## Usage

Simply open `index.html` in a modern web browser to launch the application. No build process or server required.

### Map Controls

- **Layer Selection**: Switch between Dark and Satellite map views
- **Zone Toggle**: Show/hide geofence zones
- **Name Labels**: Show/hide driver name labels
- **Theme Switcher**: Change between Dark, Light, and Black themes

### Sidebar Panel

The live fleet panel provides:
- List of active fleet vehicles
- Driver information
- Filter controls
- Route details

## Development

This is a single-file application where all HTML, CSS, and JavaScript are contained within `index.html`. To modify the application:

1. Edit `index.html` directly
2. Test changes by refreshing the browser
3. No build step required

## Browser Compatibility

- Chrome (recommended)
- Firefox
- Safari
- Edge
- Mobile browsers (iOS Safari, Chrome for Android)

## License

See the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Leaflet.js](https://leafletjs.com/) - Interactive maps library
- [OpenStreetMap](https://www.openstreetmap.org/) - Map data
- [Mapbox](https://www.mapbox.com/) - Map tiles and services
