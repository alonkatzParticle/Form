// Default Monday update templates, one per board.
// Each template is an HTML string with {{fieldKey}} placeholders.
// Block elements (<p>, <h2>, <h3>) whose field refs all resolve to empty
// are automatically removed at render time.
// Edit these in Settings → Update Format, or change the defaults here.

export const DEFAULT_UPDATE_TEMPLATES = {
  video: [
    "<p><b>Versions Needed:</b> {{versionsNeeded}}</p>",
    "<br>",
    "<p><b>Product:</b> {{product}}</p>",
    "<p><b>Type:</b> {{type}}</p>",
    "<p><b>Platform:</b> {{platform}}</p>",
    "<p><b>Requestor:</b> {{requestor}}</p>",
    "<p><b>Deadline:</b> {{deadline}}</p>",
    "<br>",
    "<h3>Video Concept</h3>",
    "<p>{{videoConcept}}</p>",
    "<br>",
    "<h3>Hook Variations</h3>",
    "<p>{{hooks}}</p>",
    "<p><b>Script / Message:</b> {{scriptMessage}}</p>",
    "<p><b>Sizes Needed:</b> {{sizesNeeded}}</p>",
    "<p><b>Dropbox:</b> {{dropboxLink}}</p>",
  ].join(""),

  design: [
    "<p><b>Versions:</b> {{amountOfVersions}}</p>",
    "<br>",
    "<p><b>Product:</b> {{productBundle}}</p>",
    "<p><b>Platform:</b> {{platform}}</p>",
    "<p><b>Website Type:</b> {{websiteType}}</p>",
    "<p><b>Requestor:</b> {{requestor}}</p>",
    "<p><b>Deadline:</b> {{deadline}}</p>",
    "<br>",
    "<h3>Concept / Idea</h3>",
    "<p>{{conceptIdea}}</p>",
    "<br>",
    "<p><b>Supporting Text:</b> {{supportingText}}</p>",
    "<p><b>Sizes:</b> {{sizes}}</p>",
    "<p><b>Dropbox:</b> {{dropbox}}</p>",
  ].join(""),
};
