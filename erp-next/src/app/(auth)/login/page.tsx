// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
'use client'

import React, { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/UI/Card'
import { Input } from '@/components/UI/Input'
import { Button } from '@/components/UI/Button'
import Link from 'next/link'
import Image from 'next/image'

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [errorMsg, setErrorMsg] = useState('')

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setErrorMsg('')
        const supabase = createClient()
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (error) {
            setErrorMsg(error.message)
            setIsLoading(false)
        } else {
            window.location.href = '/'
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full space-y-8">
                <div className="text-center">
                    <div className="flex justify-center mb-4">
                        <Image src="/logo.png" alt="Deji and Kola Logo" width={96} height={80} className="h-20 w-auto object-contain" priority />
                    </div>
                    <h2 className="text-3xl font-serif font-bold text-maison-primary">
                        Deji and Kola
                    </h2>
                    <p className="mt-2 text-sm text-maison-secondary">
                        Sign in to the Production Management ERP
                    </p>
                </div>

                <Card padding="p-8">
                    <form className="space-y-6" onSubmit={handleLogin}>
                        {errorMsg && (
                            <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm border border-red-100">
                                {errorMsg}
                            </div>
                        )}
                        <div className="space-y-4">
                            <Input
                                label="Email Address"
                                type="email"
                                required
                                value={email}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                                placeholder="name@dejiandkola.com"
                            />
                            <Input
                                label="Password"
                                labelRight={
                                    <Link href="/forgot-password" className="text-maison-accent hover:underline focus:outline-none">
                                        Forgot password?
                                    </Link>
                                }
                                type="password"
                                required
                                value={password}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full"
                            isLoading={isLoading}
                        >
                            Log in
                        </Button>
                    </form>
                </Card>
            </div>
        </div>
    )
}
