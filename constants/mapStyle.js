// Dark map for Google Maps (Android). iOS uses Apple Maps' own dark style via
// MapView userInterfaceStyle.
export const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1e201c" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#a59d95" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#121110" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#252722" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1f2a1f" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#33302b" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1c1a18" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#4a3a2a" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2a2724" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f1a22" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#5d7380" }] },
];
