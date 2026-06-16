// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
'use client'

import React, { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/UI/Card'
import { Input } from '@/components/UI/Input'
import { Button } from '@/components/UI/Button'
import Link from 'next/link'

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [errorMsg, setErrorMsg] = useState('')
    const [successMsg, setSuccessMsg] = useState('')

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setErrorMsg('')
        setSuccessMsg('')
        const supabase = createClient()
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        })

        if (error) {
            setErrorMsg(error.message)
        } else {
            setSuccessMsg('Password reset instructions have been sent to your email.')
        }
        setIsLoading(false)
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full space-y-8">
                <div className="text-center">
                    <h2 className="mt-6 text-3xl font-serif font-bold text-maison-primary">
                        Forgot Password
                    </h2>
                    <p className="mt-2 text-sm text-maison-secondary">
                        Enter your email to receive reset instructions
                    </p>
                </div>

                <Card className="" padding="p-8">
                    <form className="space-y-6" onSubmit={handleReset}>
                        {errorMsg && (
                            <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm border border-red-100">
                                {errorMsg}
                            </div>
                        )}
                        {successMsg && (
                            <div className="bg-green-50 text-green-700 p-3 rounded-md text-sm border border-green-100">
                                {successMsg}
                            </div>
                        )}
                        <div className="space-y-4">
                            <Input
                                label="Email Address"
                                type="email"
                                required
                                value={email}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                                placeholder="name@maison.com"
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full"
                            isLoading={isLoading}
                            disabled={isLoading}
                        >
                            Send Reset Link
                        </Button>

                        <div className="text-center mt-4 pt-2">
                            <Link href="/login" className="text-sm font-medium text-maison-accent hover:underline focus:outline-none">
                                Back to Log In
                            </Link>
                        </div>
                    </form>
                </Card>
            </div>
        </div>
    )
}
