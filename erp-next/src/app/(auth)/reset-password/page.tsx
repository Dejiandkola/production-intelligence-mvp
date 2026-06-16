// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
'use client'

import React, { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/UI/Card'
import { Input } from '@/components/UI/Input'
import { Button } from '@/components/UI/Button'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [errorMsg, setErrorMsg] = useState('')
    const [successMsg, setSuccessMsg] = useState('')
    const router = useRouter()

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (password !== confirmPassword) {
            setErrorMsg("Passwords do not match")
            return
        }

        setIsLoading(true)
        setErrorMsg('')
        setSuccessMsg('')

        const supabase = createClient()
        const { error } = await supabase.auth.updateUser({
            password: password
        })

        if (error) {
            setErrorMsg(error.message)
            setIsLoading(false)
        } else {
            setSuccessMsg('Your password has been successfully updated. Redirecting to login...')
            setTimeout(() => {
                router.push('/login')
            }, 3000)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full space-y-8">
                <div className="text-center">
                    <h2 className="mt-6 text-3xl font-serif font-bold text-maison-primary">
                        Set New Password
                    </h2>
                    <p className="mt-2 text-sm text-maison-secondary">
                        Enter your new password below
                    </p>
                </div>

                <Card padding="p-8">
                    <form className="space-y-6" onSubmit={handleUpdate}>
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
                                label="New Password"
                                type="password"
                                required
                                value={password}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                            <Input
                                label="Confirm New Password"
                                type="password"
                                required
                                value={confirmPassword}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full"
                            isLoading={isLoading}
                            disabled={!!successMsg}
                        >
                            Update Password
                        </Button>
                    </form>
                </Card>
            </div>
        </div>
    )
}
