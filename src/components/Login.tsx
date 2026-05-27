'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Loader2, AlertCircle } from 'lucide-react';
import keycloak from '@/keycloak';

let keycloakInitPromise: Promise<boolean> | null = null;

function getKeycloakSession() {
  if (keycloak.authenticated) {
    return Promise.resolve(true);
  }

  if (keycloak.didInitialize) {
    return Promise.resolve(Boolean(keycloak.authenticated));
  }

  if (!keycloakInitPromise) {
    keycloakInitPromise = keycloak.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      silentCheckSsoFallback: false,
      checkLoginIframe: false,
      pkceMethod: 'S256'
    }).catch(error => {
      keycloakInitPromise = null;
      throw error;
    });
  }

  return keycloakInitPromise;
}

const Login: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [checkingSso, setCheckingSso] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const launchToken = searchParams.get('launchToken') || searchParams.get('bt_token');
    if (!launchToken) return;

    const authenticateLaunch = async () => {
      setLaunching(true);
      setError(null);

      try {
        const response = await fetch('/api/auth/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ launchToken })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          setError(data.error || 'Could not authenticate BharatTech launch token.');
          return;
        }

        router.replace('/dashboard?mode=admin');
      } catch {
        setError('Could not authenticate BharatTech launch token.');
      } finally {
        setLaunching(false);
      }
    };

    authenticateLaunch();
  }, [router, searchParams]);

  useEffect(() => {
    const launchToken = searchParams.get('launchToken') || searchParams.get('bt_token');
    if (launchToken) return;

    let cancelled = false;

    const authenticateExistingBharatTechSession = async () => {
      setCheckingSso(true);

      try {
        const authenticated = await getKeycloakSession();
        if (cancelled || !authenticated || !keycloak.token) return;

        const response = await fetch('/api/auth/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ launchToken: keycloak.token })
        });

        if (cancelled || !response.ok) return;

        router.replace('/dashboard?mode=admin');
      } catch (error) {
        console.warn('BharatTech SSO check failed:', error);
      } finally {
        if (!cancelled) {
          setCheckingSso(false);
        }
      }
    };

    authenticateExistingBharatTechSession();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Authentication failed');
        return;
      }

      // Redirect to studies on success
      router.push('/studies');
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-900 flex items-center justify-center px-4 py-5 sm:p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-sm w-full"
      >
        <div className="bg-stone-800/50 rounded-xl border border-stone-700 p-4 sm:p-8">
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-full bg-stone-700 flex items-center justify-center mx-auto mb-4">
              <Lock size={24} className="text-stone-300" />
            </div>
            <h1 className="text-xl font-bold text-white">Researcher Login</h1>
            <p className="text-stone-400 text-sm mt-1">
              {launching
                ? 'Signing you in from BharatTech...'
                : checkingSso
                  ? 'Checking your BharatTech session...'
                : 'Enter your admin password to access the dashboard'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-stone-300 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                className="w-full px-4 py-3 rounded-xl bg-stone-800 border border-stone-600 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:border-stone-500"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={!password.trim() || loading || launching || checkingSso}
              className="w-full py-3 bg-stone-600 hover:bg-stone-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {loading || launching || checkingSso ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {launching || checkingSso ? 'Signing in...' : 'Logging in...'}
                </>
              ) : (
                'Login'
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-stone-700 text-center">
            <button
              onClick={() => router.push('/setup')}
              className="text-sm text-stone-400 hover:text-stone-300 transition-colors"
            >
              Back to Study Setup
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
