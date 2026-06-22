#!/usr/bin/env python3
"""
专门翻译 modules 部分的脚本
每次翻译 5 个模块，避免请求过大
"""

import asyncio
import json
import os
import sys
import aiohttp
from pathlib import Path

# API 配置
with open(os.path.join(os.path.dirname(__file__), 'transpage_config.json')) as f:
    config = json.load(f)

API_KEY = config['api_key']
API_URL = f"{config['api_base_url'].rstrip('/')}/chat/completions"
MODEL = config['model']
TIMEOUT = 300  # 5 minutes per chunk

# 目标语言
LANGUAGES = config.get('languages', ['es', 'pt', 'ja', 'ko', 'fr', 'de', 'it'])

# 语言名称
LANG_NAMES = config.get('lang_names', {
    'es': 'Spanish (Latin America)',
    'pt': 'Portuguese (Brazil)',
    'ja': 'Japanese',
    'ko': 'Korean',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian'
})

CHUNK_SIZE = 5  # modules per API call

script_dir = Path(__file__).parent
project_dir = script_dir.parent.parent.parent.parent
locales_dir = project_dir / 'src' / 'locales'

async def translate_chunk(session, chunk_data: dict, lang: str, lang_name: str, retries: int = 5) -> dict:
    """Translate a small chunk of modules"""

    prompt = f"""You are a professional game wiki translator. Translate the following JSON content from English to {lang_name}.

CRITICAL RULES:
1. Keep ALL JSON keys EXACTLY as-is (do not translate keys)
2. Keep proper nouns unchanged: Reawakened, Roblox, Discord, Vayron Studios, Hunter, Gate, Dungeon, Trait, Path, Gear
3. Return ONLY valid JSON, no markdown code blocks, no extra text
4. Translate ALL string values to {lang_name}
5. Preserve all special characters, URLs, and HTML if any
6. Arrays must maintain the same length

JSON to translate:
{json.dumps(chunk_data, ensure_ascii=False, indent=2)}"""

    for attempt in range(retries):
        try:
            async with session.post(
                API_URL,
                headers={
                    'Authorization': f'Bearer {API_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': MODEL,
                    'messages': [{'role': 'user', 'content': prompt}],
                    'max_tokens': 32768,
                    'temperature': 0.1
                },
                timeout=aiohttp.ClientTimeout(total=TIMEOUT)
            ) as resp:
                if resp.status == 429:
                    wait = 30 * (attempt + 1)
                    print(f"  Rate limit, waiting {wait}s...")
                    await asyncio.sleep(wait)
                    continue

                if resp.status != 200:
                    text = await resp.text()
                    print(f"  API error {resp.status}: {text[:100]}")
                    await asyncio.sleep(10)
                    continue

                data = await resp.json()
                content = data['choices'][0]['message']['content'].strip()

                # Remove markdown code blocks if present
                if content.startswith('```'):
                    lines = content.split('\n')
                    content = '\n'.join(lines[1:-1] if lines[-1] == '```' else lines[1:])

                translated = json.loads(content)
                return translated

        except json.JSONDecodeError as e:
            print(f"  JSON error (attempt {attempt+1}): {str(e)[:100]}")
            await asyncio.sleep(5)
        except asyncio.TimeoutError:
            print(f"  Timeout (attempt {attempt+1})")
            await asyncio.sleep(10)
        except Exception as e:
            print(f"  Error (attempt {attempt+1}): {str(e)[:100]}")
            await asyncio.sleep(5)

    return None


async def translate_modules_for_lang(lang: str):
    """Translate the modules section for a single language"""

    print(f"\n=== Translating modules for {lang.upper()} ===")

    # Load English source
    en_file = locales_dir / 'en.json'
    with open(en_file) as f:
        en_data = json.load(f)

    en_modules = en_data.get('modules', {})
    module_keys = list(en_modules.keys())

    print(f"  Total modules: {len(module_keys)}")

    # Load existing translation (if any)
    lang_file = locales_dir / f'{lang}.json'
    if lang_file.exists():
        with open(lang_file) as f:
            lang_data = json.load(f)
    else:
        # Start from English as template
        lang_data = json.loads(json.dumps(en_data))

    translated_modules = lang_data.get('modules', {})
    lang_name = LANG_NAMES.get(lang, lang)

    # Check if modules already have new keys
    has_new_keys = any(k.startswith('reawakenд') or k.startswith('reawakend') for k in translated_modules.keys())
    if has_new_keys and all(k in translated_modules for k in module_keys):
        # Check if it's actually translated (not just English)
        first_key = module_keys[0]
        first_mod = translated_modules.get(first_key, {})
        intro = first_mod.get('intro', '') if isinstance(first_mod, dict) else ''
        # Check if intro looks like it's not English (simple heuristic)
        en_intro = en_modules[first_key].get('intro', '') if isinstance(en_modules[first_key], dict) else ''
        if intro != en_intro and intro:
            print(f"  Already translated, skipping")
            return True

    # Translate in chunks
    all_translated = {}

    async with aiohttp.ClientSession() as session:
        for i in range(0, len(module_keys), CHUNK_SIZE):
            chunk_keys = module_keys[i:i + CHUNK_SIZE]
            chunk_data = {k: en_modules[k] for k in chunk_keys}

            print(f"  Chunk {i//CHUNK_SIZE + 1}/{(len(module_keys) + CHUNK_SIZE - 1)//CHUNK_SIZE}: {chunk_keys[:2]}...")

            result = await translate_chunk(session, chunk_data, lang, lang_name)

            if result is None:
                print(f"  FAILED chunk {i//CHUNK_SIZE + 1}")
                return False

            # Verify keys match
            if set(result.keys()) != set(chunk_keys):
                print(f"  Key mismatch, using original for missing keys")
                for k in chunk_keys:
                    if k not in result:
                        result[k] = en_modules[k]

            all_translated.update(result)
            print(f"  ✓ Chunk {i//CHUNK_SIZE + 1} done ({len(result)} modules)")

    if len(all_translated) < len(module_keys):
        print(f"  Incomplete: only {len(all_translated)}/{len(module_keys)} modules translated")
        return False

    # Update the lang data with translated modules
    lang_data['modules'] = all_translated

    # Write back
    with open(lang_file, 'w', encoding='utf-8') as f:
        json.dump(lang_data, f, ensure_ascii=False, indent=2)

    print(f"  ✓ Written {lang_file}")
    return True


async def main():
    # First, assemble complete files from chunks for each language
    print("=== Step 1: Assemble files from saved chunks ===")

    chunks_dir = script_dir.parent.parent.parent.parent / 'temp' / 'chunks'

    en_file = locales_dir / 'en.json'
    with open(en_file) as f:
        en_data = json.load(f)

    for lang in LANGUAGES:
        lang_file = locales_dir / f'{lang}.json'

        # Check which sections have saved chunks
        chunk_files = {}
        for section in ['seo', 'nav', 'common', 'hero', 'gameFeature', 'tools', 'faq', 'cta', 'footer', 'pages']:
            chunk_file = chunks_dir / f'{lang}_{section}.json'
            if chunk_file.exists():
                with open(chunk_file) as f:
                    chunk_data = json.load(f)
                chunk_files[section] = chunk_data

        if not chunk_files:
            print(f"{lang}: no chunks found, skipping assembly")
            continue

        # Load or create lang data
        if lang_file.exists():
            with open(lang_file) as f:
                lang_data = json.load(f)
        else:
            lang_data = json.loads(json.dumps(en_data))

        # Update sections from chunks
        updated = []
        for section, section_data in chunk_files.items():
            if section in section_data:
                lang_data[section] = section_data[section]
                updated.append(section)
            elif isinstance(section_data, dict) and section_data:
                # Chunk might be stored as {section: data} or just data
                lang_data[section] = section_data
                updated.append(section)

        if updated:
            with open(lang_file, 'w', encoding='utf-8') as f:
                json.dump(lang_data, f, ensure_ascii=False, indent=2)
            print(f"{lang}: assembled from chunks: {updated}")

    print("\n=== Step 2: Translate modules section ===")

    for lang in LANGUAGES:
        success = await translate_modules_for_lang(lang)
        if not success:
            print(f"  FAILED for {lang}")
        await asyncio.sleep(2)  # Small delay between languages

    print("\n=== Done ===")


if __name__ == '__main__':
    asyncio.run(main())
