#!/usr/bin/env node
import * as dotenv from 'dotenv'
dotenv.config()

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import Groq from 'groq-sdk'
import { extractTextFromPDF, chunkText } from './chunker'
import { getEmbedding } from './embeddings'
import { scrapeJobDescription } from './scraper'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const program = new Command()

program
  .name('resumematch')
  .description('AI-powered resume gap analyzer')
  .version('1.0.0')
  .argument('<resume>', 'Path to your resume PDF')
  .argument('<job>', 'Job description URL or text')
  .action(async (resumePath: string, job: string) => {
    console.log(chalk.bold.blue('\n🧠 ResumeMatch — AI Resume Analyzer\n'))

    // 1. Read resume
    const spinner = ora('Reading resume...').start()
    const absolutePath = path.resolve(resumePath)
    if (!fs.existsSync(absolutePath)) {
      spinner.fail(chalk.red('Resume file not found'))
      process.exit(1)
    }
    const buffer = fs.readFileSync(absolutePath)
    const resumeText = await extractTextFromPDF(buffer)
    spinner.succeed('Resume loaded')

    // 2. Get job description
    const spinner2 = ora('Fetching job description...').start()
    let jobDescription = job
    if (job.startsWith('http')) {
      jobDescription = await scrapeJobDescription(job)
    }
    spinner2.succeed('Job description ready')

    // 3. Chunk and embed resume
    const spinner3 = ora('Generating embeddings...').start()
    const chunks = chunkText(resumeText)
    await supabase.from('document_chunks').delete().neq('id', 0)

    for (const chunk of chunks) {
      const embedding = await getEmbedding(chunk)
      await supabase.from('document_chunks').insert({
        content: chunk,
        embedding,
        metadata: { type: 'resume' }
      })
    }
    spinner3.succeed(`Embedded ${chunks.length} chunks`)

    // 4. Find relevant chunks
    const spinner4 = ora('Running semantic search...').start()
    const jdEmbedding = await getEmbedding(jobDescription.slice(0, 1000))
    const { data: relevantChunks } = await supabase.rpc('match_chunks', {
      query_embedding: jdEmbedding,
      match_count: 5
    })
    const context = relevantChunks?.map((c: any) => c.content).join('\n\n') ?? resumeText.slice(0, 2000)
    spinner4.succeed('Semantic search complete')

    // 5. Analyze with Groq
    const spinner5 = ora('Analyzing with AI...').start()
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are an expert resume reviewer. Analyze the resume against the job description and return ONLY a JSON object with this exact structure:
{
  "matchScore": <number 0-100>,
  "strengths": [<string>, <string>, <string>],
  "gaps": [<string>, <string>, <string>],
  "suggestions": [<string>, <string>, <string>],
  "summary": "<2 sentence overall assessment>"
}`
        },
        {
          role: 'user',
          content: `Resume:\n${context}\n\nJob Description:\n${jobDescription.slice(0, 2000)}`
        }
      ]
    })

    const raw = completion.choices[0].message.content ?? '{}'
    const clean = raw.replace(/```json|```/g, '').trim()
    const result = JSON.parse(clean)
    spinner5.succeed('Analysis complete\n')

    // 6. Print results
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))

    const scoreColor = result.matchScore >= 70 ? chalk.green : result.matchScore >= 40 ? chalk.yellow : chalk.red
    console.log(chalk.bold('\n📊 Match Score: ') + scoreColor.bold(`${result.matchScore}%`))
    console.log(chalk.gray(`\n${result.summary}\n`))

    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
    console.log(chalk.green.bold('\n✓ Strengths'))
    result.strengths.forEach((s: string) => console.log(chalk.green('  • ') + s))

    console.log(chalk.red.bold('\n✗ Gaps'))
    result.gaps.forEach((g: string) => console.log(chalk.red('  • ') + g))

    console.log(chalk.blue.bold('\n→ Suggestions'))
    result.suggestions.forEach((s: string) => console.log(chalk.blue('  • ') + s))

    console.log(chalk.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'))
  })

program.parse()