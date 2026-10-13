import { useState, useEffect } from 'react';

export interface WeatherData {
  temp: number;
  feelsLike: number;
  humidity: number;
  windspeed: number;
  weathercode: number;
  city: string;
  lat: number;
  lon: number;
}

const WMO_CODES: Record<number, string> = {
  0: 'Clear Sky', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy Fog', 51: 'Light Drizzle', 53: 'Drizzle',
  55: 'Heavy Drizzle', 61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 80: 'Showers',
  81: 'Rain Showers', 82: 'Violent Showers', 95: 'Thunderstorm',
  96: 'Thunderstorm+Hail', 99: 'Heavy Thunderstorm',
};

const WMO_ICON: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️', 61: '🌧️', 63: '🌧️', 65: '⛈️',
  71: '🌨️', 73: '❄️', 75: '❄️', 80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

export function getWeatherDesc(code: number) {
  return WMO_CODES[code] || 'Unknown';
}

export function getWeatherIcon(code: number) {
  return WMO_ICON[code] || '🌡️';
}

export function useWeather() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchWeather(lat: number, lon: number, city: string) {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,windspeed_10m,weathercode&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;
        const c = data.current;
        setWeather({
          temp: Math.round(c.temperature_2m),
          feelsLike: Math.round(c.apparent_temperature),
          humidity: c.relative_humidity_2m,
          windspeed: Math.round(c.windspeed_10m),
          weathercode: c.weathercode,
          city,
          lat,
          lon,
        });
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError('Weather unavailable');
          setLoading(false);
        }
      }
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude: lat, longitude: lon } = pos.coords;
          // Reverse geocode with open-meteo (no API key needed for weather)
          let city = 'Your Location';
          try {
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
            const geoData = await geoRes.json();
            city = geoData.address?.city || geoData.address?.town || geoData.address?.village || geoData.address?.county || 'Your Location';
          } catch (_) {}
          fetchWeather(lat, lon, city);
        },
        () => {
          // Default to Kathmandu if geolocation denied
          fetchWeather(27.7172, 85.3240, 'Kathmandu');
        },
        { timeout: 5000 }
      );
    } else {
      fetchWeather(27.7172, 85.3240, 'Kathmandu');
    }

    // Refresh every 10 minutes
    const interval = setInterval(() => {
      if (weather) fetchWeather(weather.lat, weather.lon, weather.city);
    }, 600000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { weather, loading, error };
}
