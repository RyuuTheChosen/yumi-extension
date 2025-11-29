/**
 * 🔍 Quick Live2D Parameter Diagnostic
 * 
 * INSTRUCTIONS:
 * 1. Open Yumi extension sidepanel
 * 2. Wait for avatar to load
 * 3. Open browser DevTools Console (F12)
 * 4. Copy-paste this ENTIRE file into console
 * 5. Press Enter
 * 
 * This will automatically:
 * - Find your Live2D model
 * - List all available parameters
 * - Show which animations are possible
 * - Give recommendations for implementation
 */

(function() {
  console.clear()
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔍 LIVE2D PARAMETER DIAGNOSTIC TOOL')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  // Find the model
  let model = null
  
  // Strategy 1: Global reference (dev mode)
  if (window.__yumiModel) {
    console.log('✅ Found model via window.__yumiModel')
    model = window.__yumiModel
  }
  
  // Strategy 1.5: Canvas element reference (works across content script isolation)
  if (!model) {
    try {
      const overlay = document.querySelector('yumi-live2d-overlay')
      if (overlay?.shadowRoot) {
        const canvas = overlay.shadowRoot.querySelector('canvas')
        if (canvas?.__yumiModel) {
          console.log('✅ Found model via canvas.__yumiModel (content script bridge)')
          model = canvas.__yumiModel
        }
      }
    } catch (e) {
      console.log('⚠️ Could not access shadow DOM:', e.message)
    }
  }
  
  // Strategy 2: Search PIXI stage
  if (!model && window.PIXI?.Application?.instances) {
    console.log('🔎 Searching PIXI stage...')
    const apps = window.PIXI.Application.instances || []
    
    for (const app of apps) {
      const findModel = (container) => {
        if (!container) return null
        if (container.internalModel?.coreModel) return container
        if (container.children) {
          for (const child of container.children) {
            const found = findModel(child)
            if (found) return found
          }
        }
        return null
      }
      
      model = findModel(app.stage)
      if (model) {
        console.log('✅ Found model in PIXI stage')
        break
      }
    }
  }
  
  if (!model) {
    console.error('❌ COULD NOT FIND LIVE2D MODEL!')
    console.log('')
    console.log('Troubleshooting:')
    console.log('  1. Is the sidepanel open?')
    console.log('  2. Has the avatar finished loading?')
    console.log('  3. Are you in development mode? (npm run dev)')
    console.log('  4. Try refreshing the page and running again')
    return
  }
  
  const coreModel = model.internalModel?.coreModel
  
  if (!coreModel) {
    console.error('❌ Could not access core model!')
    return
  }
  
  // Get all parameters
  const paramCount = coreModel.getParameterCount()
  console.log(`📊 Found ${paramCount} parameters`)
  console.log('')
  
  const parameters = []
  
  for (let i = 0; i < paramCount; i++) {
    const id = coreModel.getParameterId(i)
    const current = coreModel.getParameterValueById(id)
    const min = coreModel.getParameterMinimumValue?.(i) ?? 0
    const max = coreModel.getParameterMaximumValue?.(i) ?? 1
    const def = coreModel.getParameterDefaultValue?.(i) ?? 0
    
    parameters.push({ i, id, current, min, max, def })
  }
  
  // Categorize
  const head = parameters.filter(p => /angle|head/i.test(p.id))
  const eyes = parameters.filter(p => /eye|pupil/i.test(p.id))
  const mouth = parameters.filter(p => /mouth|lip/i.test(p.id))
  const body = parameters.filter(p => /body/i.test(p.id))
  const breath = parameters.filter(p => /breath/i.test(p.id))
  const other = parameters.filter(p => 
    !head.includes(p) && !eyes.includes(p) && !mouth.includes(p) && 
    !body.includes(p) && !breath.includes(p)
  )
  
  // Print categorized results
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📋 PARAMETER CATEGORIES')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  if (head.length > 0) {
    console.log(`🎯 HEAD ROTATION (${head.length}):`)
    head.forEach(p => console.log(`   ${p.id}: ${p.current.toFixed(2)} [${p.min} - ${p.max}]`))
    console.log('')
  }
  
  if (eyes.length > 0) {
    console.log(`👁️  EYE MOVEMENT (${eyes.length}):`)
    eyes.forEach(p => console.log(`   ${p.id}: ${p.current.toFixed(2)} [${p.min} - ${p.max}]`))
    console.log('')
  }
  
  if (mouth.length > 0) {
    console.log(`👄 MOUTH (${mouth.length}):`)
    mouth.forEach(p => console.log(`   ${p.id}: ${p.current.toFixed(2)} [${p.min} - ${p.max}]`))
    console.log('')
  }
  
  if (body.length > 0) {
    console.log(`🧍 BODY (${body.length}):`)
    body.forEach(p => console.log(`   ${p.id}: ${p.current.toFixed(2)} [${p.min} - ${p.max}]`))
    console.log('')
  }
  
  if (breath.length > 0) {
    console.log(`💨 BREATHING (${breath.length}):`)
    breath.forEach(p => console.log(`   ${p.id}: ${p.current.toFixed(2)} [${p.min} - ${p.max}]`))
    console.log('')
  }
  
  if (other.length > 0) {
    console.log(`📦 OTHER (${other.length}):`)
    other.forEach(p => console.log(`   ${p.id}: ${p.current.toFixed(2)} [${p.min} - ${p.max}]`))
    console.log('')
  }
  
  // Analyze capabilities
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🎨 ANIMATION CAPABILITIES')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  const capabilities = {
    headMovement: head.length > 0,
    eyeMovement: eyes.length > 0,
    breathing: breath.length > 0,
    mouthMovement: mouth.length > 0,
    bodyMovement: body.length > 0
  }
  
  console.log(`Head Movement:   ${capabilities.headMovement ? '✅ YES' : '❌ NO'}`)
  console.log(`Eye Movement:    ${capabilities.eyeMovement ? '✅ YES' : '❌ NO'}`)
  console.log(`Breathing:       ${capabilities.breathing ? '✅ YES' : '❌ NO'}`)
  console.log(`Mouth Movement:  ${capabilities.mouthMovement ? '✅ YES (lip sync ready)' : '❌ NO'}`)
  console.log(`Body Movement:   ${capabilities.bodyMovement ? '✅ YES' : '❌ NO'}`)
  console.log('')
  
  // Recommendations
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('💡 RECOMMENDATIONS')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  
  const capCount = Object.values(capabilities).filter(Boolean).length
  
  if (capCount >= 3) {
    console.log('🎯 EXCELLENT PARAMETER SUPPORT!')
    console.log('   ✅ Proceed with Phase 2 (Parameter-Based Animation)')
    console.log('   ✅ Full thinking animation capabilities available')
    console.log('')
    console.log('Suggested animations:')
    if (capabilities.headMovement) console.log('   • Subtle head sway (contemplative look)')
    if (capabilities.eyeMovement) console.log('   • Eye scanning movement (thoughtful gaze)')
    if (capabilities.breathing) console.log('   • Enhanced breathing rate (slight nervousness)')
    if (capabilities.bodyMovement) console.log('   • Minor body tilt (engaged posture)')
  } else if (capCount >= 1) {
    console.log('🎯 LIMITED PARAMETER SUPPORT')
    console.log('   ⚠️  Proceed with Phase 2 (Simplified Animation)')
    console.log('   ⚠️  Some animations will be skipped')
    console.log('')
    console.log('Available animations:')
    if (capabilities.headMovement) console.log('   • Head movement ✅')
    if (capabilities.eyeMovement) console.log('   • Eye movement ✅')
    if (capabilities.breathing) console.log('   • Breathing ✅')
    if (capabilities.bodyMovement) console.log('   • Body movement ✅')
  } else {
    console.log('🎯 NO PARAMETER SUPPORT')
    console.log('   ⚠️  Use Phase 1 (Expression-Only)')
    console.log('   ⚠️  Stick with expression changes only')
  }
  console.log('')
  
  // Test function
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🧪 TEST ANIMATIONS')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  console.log('Try animating a parameter:')
  console.log('')
  console.log('  testParameter("ParamAngleX", 2000)  // Test for 2 seconds')
  console.log('  testParameter("ParamEyeBallX", 3000) // Test for 3 seconds')
  console.log('')
  
  // Store results globally
  window.__live2dDiagnostic = {
    model,
    coreModel,
    parameters,
    categories: { head, eyes, mouth, body, breath, other },
    capabilities
  }
  
  // Helper function
  window.testParameter = function(paramId, duration = 2000) {
    console.log(`🧪 Testing ${paramId} for ${duration}ms...`)
    
    const start = performance.now()
    const originalValue = coreModel.getParameterValueById(paramId)
    
    const animate = () => {
      const elapsed = performance.now() - start
      const progress = elapsed / duration
      
      if (progress >= 1) {
        coreModel.setParameterValueById(paramId, originalValue)
        console.log('✅ Test complete - parameter reset')
        return
      }
      
      // Sine wave animation
      const value = originalValue + Math.sin(progress * Math.PI * 4) * 1.0
      
      try {
        coreModel.setParameterValueById(paramId, value)
      } catch (error) {
        console.error('❌ Error setting parameter:', error)
        return
      }
      
      requestAnimationFrame(animate)
    }
    
    animate()
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('💾 Data saved to: window.__live2dDiagnostic')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  
})()
