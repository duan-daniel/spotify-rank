import { useState, useEffect, useCallback } from 'react'
import './App.css'

const CLIENT_ID = 'e7974284ab4b44f08570d2324f5f3d12'
const SCOPES = 'user-top-read'
const REDIRECT_URI = window.location.origin + window.location.pathname

type TimeRange = 'short_term' | 'medium_term' | 'long_term'

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  short_term: 'Last 4 Weeks',
  medium_term: 'Last 6 Months',
  long_term: 'All Time',
}

const TIME_RANGE_DESCRIPTIONS: Record<TimeRange, string> = {
  short_term: 'Your top artists from the last 4 weeks',
  medium_term: 'Your top artists from the last 6 months',
  long_term: 'Your most listened to artists of all time',
}

interface SpotifyArtist {
  id: string
  name: string
  images: { url: string; height: number; width: number }[]
  genres: string[]
  popularity: number
  external_urls: { spotify: string }
  followers: { total: number }
}

interface SpotifyUser {
  display_name: string
  images: { url: string }[]
}

// PKCE helpers
function generateRandomString(length: number): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const values = crypto.getRandomValues(new Uint8Array(length))
  return values.reduce((acc, x) => acc + possible[x % possible.length], '')
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const data = encoder.encode(plain)
  return window.crypto.subtle.digest('SHA-256', data)
}

function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ''
  bytes.forEach((b) => (str += String.fromCharCode(b)))
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function getCodeFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('code')
}

function App() {
  const [token, setToken] = useState<string | null>(null)
  const [artistsByRange, setArtistsByRange] = useState<Record<TimeRange, SpotifyArtist[]>>({
    short_term: [],
    medium_term: [],
    long_term: [],
  })
  const [activeRange, setActiveRange] = useState<TimeRange>('long_term')
  const [user, setUser] = useState<SpotifyUser | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const artists = artistsByRange[activeRange]

  useEffect(() => {
    const storedToken = sessionStorage.getItem('spotify_token')
    const code = getCodeFromUrl()

    if (code) {
      const codeVerifier = sessionStorage.getItem('spotify_code_verifier')
      if (codeVerifier) {
        exchangeCodeForToken(code, codeVerifier)
      }
      window.history.replaceState(null, '', window.location.pathname)
    } else if (storedToken) {
      setToken(storedToken)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const exchangeCodeForToken = async (code: string, codeVerifier: string) => {
    setLoading(true)
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error_description || data.error || 'Failed to exchange code for token')
      }
      if (!data.access_token) {
        throw new Error('No access token received')
      }
      setToken(data.access_token)
      sessionStorage.setItem('spotify_token', data.access_token)
      sessionStorage.removeItem('spotify_code_verifier')
    } catch (err) {
      console.error('Token exchange failed:', err)
      setError(err instanceof Error ? err.message : 'Authentication failed')
      setLoading(false)
    }
  }

  const fetchData = useCallback(async (accessToken: string) => {
    setLoading(true)
    setError(null)
    try {
      const timeRanges: TimeRange[] = ['short_term', 'medium_term', 'long_term']
      const [shortRes, mediumRes, longRes, userRes] = await Promise.all([
        ...timeRanges.map((range) =>
          fetch(`https://api.spotify.com/v1/me/top/artists?time_range=${range}&limit=50`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
        ),
        fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ])

      if (shortRes.status === 401 || mediumRes.status === 401 || longRes.status === 401 || userRes.status === 401) {
        sessionStorage.removeItem('spotify_token')
        setToken(null)
        setError('Session expired. Please log in again.')
        return
      }

      if (!shortRes.ok || !mediumRes.ok || !longRes.ok || !userRes.ok) {
        throw new Error('Failed to fetch data from Spotify')
      }

      const [shortData, mediumData, longData, userData] = await Promise.all([
        shortRes.json(),
        mediumRes.json(),
        longRes.json(),
        userRes.json(),
      ])

      setArtistsByRange({
        short_term: shortData.items || [],
        medium_term: mediumData.items || [],
        long_term: longData.items || [],
      })
      setUser(userData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) {
      fetchData(token)
    }
  }, [token, fetchData])

  const handleLogin = async () => {
    const codeVerifier = generateRandomString(64)
    sessionStorage.setItem('spotify_code_verifier', codeVerifier)
    const hashed = await sha256(codeVerifier)
    const codeChallenge = base64urlEncode(hashed)
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&code_challenge_method=S256&code_challenge=${codeChallenge}&show_dialog=true`
    window.location.href = authUrl
  }

  const handleLogout = () => {
    sessionStorage.removeItem('spotify_token')
    setToken(null)
    setArtistsByRange({ short_term: [], medium_term: [], long_term: [] })
    setUser(null)
  }

  // Login screen
  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex items-center justify-center px-4">
        <div className="text-center max-w-lg">
          <div className="mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/10 mb-6">
              <svg viewBox="0 0 24 24" className="w-10 h-10 text-green-500 fill-current">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
            </div>
            <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
              Your Top Artists
            </h1>
            <p className="text-zinc-400 text-lg mb-2">
              Discover your most listened to artists of all time on Spotify
            </p>
            {error && (
              <p className="text-red-400 text-sm mt-4 bg-red-400/10 rounded-lg px-4 py-2 inline-block">
                {error}
              </p>
            )}
          </div>
          <button
            onClick={handleLogin}
            className="inline-flex items-center gap-3 bg-green-500 hover:bg-green-400 text-black font-semibold px-8 py-4 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg shadow-green-500/25"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            Log in with Spotify
          </button>
        </div>
      </div>
    )
  }

  // Loading screen
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-green-500/30 border-t-green-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-zinc-400 text-lg">Loading your top artists...</p>
        </div>
      </div>
    )
  }

  // Main content
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-zinc-950/80 border-b border-zinc-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-green-500 fill-current">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            <h1 className="text-xl font-bold text-white">Your Top Artists</h1>
          </div>
          <div className="flex items-center gap-4">
            {user && (
              <div className="flex items-center gap-2">
                {user.images?.[0] && (
                  <img
                    src={user.images[0].url}
                    alt={user.display_name}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                )}
                <span className="text-zinc-300 text-sm hidden sm:inline">{user.display_name}</span>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="text-zinc-400 hover:text-white text-sm transition-colors px-3 py-1.5 rounded-lg hover:bg-zinc-800"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Hero section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-4">
        <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2">
          {user ? `${user.display_name}'s` : 'Your'} Top Artists
        </h2>
        <p className="text-zinc-400 text-lg mb-6">
          {TIME_RANGE_DESCRIPTIONS[activeRange]}
        </p>

        {/* Time range tabs */}
        <div className="flex gap-2">
          {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setActiveRange(range)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                activeRange === range
                  ? 'bg-green-500 text-black'
                  : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/60 hover:text-white'
              }`}
            >
              {TIME_RANGE_LABELS[range]}
            </button>
          ))}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
          <div className="bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!error && artists.length === 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <p className="text-zinc-400 text-lg">No top artists found for this time range.</p>
          <p className="text-zinc-500 text-sm mt-2">Try selecting a different time range above.</p>
        </div>
      )}

      {/* Top 3 Podium */}
      {artists.length >= 3 && (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
          <div className="grid grid-cols-3 gap-3 sm:gap-6 items-end">
            {/* #2 */}
            <div className="flex flex-col items-center group">
              <div className="relative mb-3">
                <div className="absolute -inset-1 bg-zinc-400/20 rounded-full blur-md group-hover:blur-lg transition-all" />
                <img
                  src={artists[1].images[0]?.url || 'https://placehold.co/300x300/png'}
                  alt={artists[1].name}
                  className="relative w-24 h-24 sm:w-36 sm:h-36 rounded-full object-cover ring-2 ring-zinc-400/50"
                />
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-zinc-700 text-white text-xs font-bold w-7 h-7 flex items-center justify-center rounded-full">
                  2
                </div>
              </div>
              <a href={artists[1].external_urls.spotify} target="_blank" rel="noopener noreferrer" className="text-white font-semibold text-sm sm:text-base text-center hover:text-green-400 transition-colors mt-1">
                {artists[1].name}
              </a>
              <p className="text-zinc-500 text-xs mt-0.5">{artists[1].genres[0] || ''}</p>
            </div>
            {/* #1 */}
            <div className="flex flex-col items-center group">
              <div className="relative mb-3">
                <div className="absolute -inset-1.5 bg-yellow-500/20 rounded-full blur-lg group-hover:blur-xl transition-all" />
                <img
                  src={artists[0].images[0]?.url || 'https://placehold.co/300x300/png'}
                  alt={artists[0].name}
                  className="relative w-32 h-32 sm:w-44 sm:h-44 rounded-full object-cover ring-2 ring-yellow-500/50"
                />
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-yellow-500 text-black text-xs font-bold w-8 h-8 flex items-center justify-center rounded-full shadow-lg shadow-yellow-500/30">
                  1
                </div>
              </div>
              <a href={artists[0].external_urls.spotify} target="_blank" rel="noopener noreferrer" className="text-white font-bold text-base sm:text-lg text-center hover:text-green-400 transition-colors mt-1">
                {artists[0].name}
              </a>
              <p className="text-zinc-500 text-xs mt-0.5">{artists[0].genres[0] || ''}</p>
            </div>
            {/* #3 */}
            <div className="flex flex-col items-center group">
              <div className="relative mb-3">
                <div className="absolute -inset-1 bg-amber-700/20 rounded-full blur-md group-hover:blur-lg transition-all" />
                <img
                  src={artists[2].images[0]?.url || 'https://placehold.co/300x300/png'}
                  alt={artists[2].name}
                  className="relative w-20 h-20 sm:w-32 sm:h-32 rounded-full object-cover ring-2 ring-amber-700/50"
                />
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-amber-700 text-white text-xs font-bold w-7 h-7 flex items-center justify-center rounded-full">
                  3
                </div>
              </div>
              <a href={artists[2].external_urls.spotify} target="_blank" rel="noopener noreferrer" className="text-white font-semibold text-sm sm:text-base text-center hover:text-green-400 transition-colors mt-1">
                {artists[2].name}
              </a>
              <p className="text-zinc-500 text-xs mt-0.5">{artists[2].genres[0] || ''}</p>
            </div>
          </div>
        </div>
      )}

      {/* Full list */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="grid gap-2">
          {artists.slice(3).map((artist, index) => (
            <a
              key={artist.id}
              href={artist.external_urls.spotify}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 p-3 rounded-xl hover:bg-zinc-800/60 transition-all duration-200 group"
            >
              <span className="text-zinc-600 font-mono text-sm w-8 text-right shrink-0">
                {index + 4}
              </span>
              <img
                src={artist.images[artist.images.length > 1 ? 1 : 0]?.url || 'https://placehold.co/64x64/png'}
                alt={artist.name}
                className="w-12 h-12 rounded-full object-cover shrink-0 group-hover:ring-2 ring-green-500/30 transition-all"
              />
              <div className="min-w-0 flex-1">
                <p className="text-white font-medium truncate group-hover:text-green-400 transition-colors">
                  {artist.name}
                </p>
                <p className="text-zinc-500 text-sm truncate">
                  {artist.genres.slice(0, 3).join(' · ') || 'No genres listed'}
                </p>
              </div>
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500/60 rounded-full"
                    style={{ width: `${artist.popularity}%` }}
                  />
                </div>
                <span className="text-zinc-600 text-xs w-6">{artist.popularity}</span>
              </div>
              <span className="text-zinc-500 text-sm hidden md:block shrink-0">
                {artist.followers.total.toLocaleString()} followers
              </span>
            </a>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 py-6 text-center">
        <p className="text-zinc-600 text-sm">
          Powered by the Spotify Web API
        </p>
      </footer>
    </div>
  )
}

export default App
